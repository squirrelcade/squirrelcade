// Squirrelcade Deal check, on the page (D245). Put here by the toolbar button, only on the tab it was pressed on:
// it reads the listings on this page (nothing else: no other pages, no scrolling or paging), asks Squirrelcade about
// them through the extension, and puts a badge on each: the Stash's chest (filled: yours; half: yours on another console;
// grey: not) and the console marks, which open the game's drawer; its acorns, a button to change your preference;
// PriceCharting's prices and the deal meter; and H, M or L for how sure the answer is, with why.
// Pressing the button again checks the page again (more results may have loaded).
(() => {
  if (window.__squirrelcadeDeal) {
    window.__squirrelcadeDeal.scan();
    return;
  }

  const OFF = '#b4b4b9';
  const SURE = {
    sure: { color: '#2f9e44', word: 'Sure' },
    likely: { color: '#f0b400', word: 'Pretty sure' },
    unsure: { color: '#e03131', word: 'Not sure' },
  };
  const FLAGS = { 'game-key-card': 'Game-Key Card', 'code-in-box': 'Code in box', digital: 'Digital' };

  // The Stash's chest and the acorn, exactly as Squirrelcade draws them (apps/web/src/Acorn.tsx). The chest is filled
  // (yours on this console), grey (not yours), or half: its lower right filled, its upper left grey (yours on another
  // console or PC; the owner's design, 2026-11-24).
  const CHEST_FRAME = 'M1 0h5v1H1zM0 1h1v5H0zM6 1h1v5H6zM1 2h2v1H1zM4 2h2v1H4zM1 5h5v1H1z';
  const CHEST_FILL = 'M1 1h5v1H1zM1 3h2v2H1zM4 3h2v2H4zM3 4h1v1H3z';
  const CHEST_LOCK = 'M3 2h1v2H3z';
  const chestParts = (owned) =>
    `<path d="${CHEST_FRAME}" fill="${owned ? '#6b3a10' : OFF}"/>${owned ? `<path d="${CHEST_FILL}" fill="#c27a3f"/>` : ''}<path d="${CHEST_LOCK}" fill="${owned ? '#e9b44c' : OFF}"/>`;
  const chest = (kind, size = 14) => {
    const shown = kind === true ? 'own' : kind === false ? 'none' : kind;
    const body = shown === 'elsewhere' ? `<defs><clipPath id="sc-half"><path d="M7 0V6H0z"/></clipPath></defs>${chestParts(false)}<g clip-path="url(#sc-half)">${chestParts(true)}</g>` : chestParts(shown === 'own');
    return `<svg viewBox="0 0 7 6" width="${Math.round((size * 7) / 6)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
  };
  const acorn = (size = 13) =>
    `<svg viewBox="0 0 5 6" width="${Math.round((size * 5) / 6)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h1v1H2zM0 1h5v2H0z" fill="#6b3a10"/><path d="M1 3h3v2H1zM2 5h1v1H2z" fill="#46a36b"/></svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (c) => (c === null || c === undefined ? '—' : `$${(c / 100).toFixed(2)}`);
  const priceIn = (text) => {
    const m = /\$\s*([\d,]+(?:\.\d\d)?)/.exec(text ?? '');
    return m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : null;
  };
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  // A line that is only a console's name (Amazon's "Nintendo Switch 2" under a result).
  const CONSOLE_LINE =
    /^(nintendo switch 2|nintendo switch|switch 2|playstation ?[1-5]|ps[1-5]|playstation vita|ps vita|xbox series x\s*[|/]?\s*s?|xbox series s|xbox one|xbox 360|wii u|wii|nintendo 3ds|nintendo ds|nintendo gamecube|gamecube|nintendo 64|super nintendo|game boy advance|game boy color|game boy|sega genesis|sega dreamcast)$/i;
  const CONSOLE_WORDS =
    /\b(nintendo switch 2|switch 2|ns2|nintendo switch|switch|playstation ?[1-5]|ps[1-5]|xbox series x|xbox series|xbox one|xbox 360|wii u|wii|3ds|gamecube|n64|snes|nes|genesis|dreamcast)\b/i;
  const FORMAT_LINE = /^(digital code in (a )?box|(game )?(download )?code in (a )?box|game[- ]key card|digital code|online game code|email delivery)$/i;
  const consoleIn = (s) => CONSOLE_WORDS.exec(s ?? '')?.[1] ?? null;
  const query = (name) => new URLSearchParams(location.search).get(name);

  /** The listings on this page: where to put each badge, its title, price, seller and a console the page names. */
  const READERS = {
    amazon: {
      name: 'Amazon',
      test: () => /(^|\.)amazon\.(com|ca|co\.uk|de|fr|it|es|co\.jp|com\.au|com\.mx)$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('k'));
        const out = [];
        for (const card of document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')) {
          if (!card.dataset.asin) continue;
          // Amazon's newer cards put the brand in a small h2 of its own ("Busjoy") above the title's: take the longest.
          const h2 = [...card.querySelectorAll('h2')].sort((a, b) => text(b).length - text(a).length)[0];
          if (!h2) continue;
          let title = (h2.getAttribute('aria-label') || text(h2)).replace(/^Sponsored Ad\s*[-–—]\s*/i, '').trim();
          // The format Amazon prints on its own line under the title ("Digital Code in Box", "Game-Key Card"): sent in
          // brackets with the title, where Squirrelcade reads the copy's flags and takes them out of the game's name.
          const format = [...card.querySelectorAll('span, a, div')].map(text).find((t) => t.length < 40 && FORMAT_LINE.test(t));
          if (format && !title.toLowerCase().includes(format.toLowerCase())) title = `${title} [${format}]`;
          const line = [...card.querySelectorAll('a.a-text-bold, span.a-text-bold, a.s-underline-text')].map(text).find((t) => CONSOLE_LINE.test(t));
          const price = priceIn(text(card.querySelector('.a-price:not([data-a-strike]) .a-offscreen')));
          out.push({ at: h2, title, price, seller: null, marketplace: false, hint: line ?? pageHint });
        }
        const pt = document.querySelector('#productTitle');
        if (pt) {
          const platformText = ['#platformInformation_feature_div', '[id^="inline-twister-expanded-dimension-text-platform"]', '#variation_platform_for_display .selection', '#detailBullets_feature_div', '#productOverview_feature_div']
            .map((s) => text(document.querySelector(s)))
            .join(' ');
          const sellerEl = document.querySelector('#sellerProfileTriggerId') ?? document.querySelector('#merchantInfoFeature_feature_div .offer-display-feature-text-message');
          const seller = text(sellerEl) || null;
          const price = priceIn(text(document.querySelector('.priceToPay .a-offscreen, #corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen')));
          out.push({ at: pt, title: text(pt), price, seller, marketplace: Boolean(seller && !/amazon/i.test(seller)), hint: consoleIn(platformText) });
        }
        return out;
      },
    },
    walmart: {
      name: 'Walmart',
      test: () => /(^|\.)walmart\.(com|ca)$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('q'));
        const out = [];
        for (const tile of document.querySelectorAll('[data-item-id]')) {
          const t = tile.querySelector('[data-automation-id="product-title"]');
          if (!t) continue;
          const all = tile.innerText ?? '';
          const sold = /Sold (?:and shipped )?by\s+([^\n$]+?)(?:\s{2,}|$)/im.exec(all)?.[1]?.trim() ?? null;
          // "Price $24.88", "current price $24.88", "Now $24.88": the first one is the tile's price.
          const price = priceIn(/(?:current price|now|price)\s*\$\s*[\d,]+(?:\.\d\d)?/i.exec(all)?.[0]) ?? priceIn(text(tile.querySelector('[data-automation-id="product-price"]')));
          out.push({ at: t, title: text(t), price, seller: sold, marketplace: Boolean(sold && !/walmart/i.test(sold)), hint: consoleIn(text(t)) ? null : pageHint });
        }
        const h1 = document.querySelector('h1#main-title, h1[itemprop="name"]');
        if (h1) {
          const info = text(document.querySelector('[data-testid="product-seller-info"]')) || /Sold (?:and shipped )?by\s+[^\n]+/i.exec(document.body.innerText)?.[0] || '';
          const seller = /by\s+(.+)$/i.exec(info)?.[1]?.trim() ?? null;
          const price = priceIn(text(document.querySelector('[itemprop="price"], [data-seo-id="hero-price"], [data-testid="price-wrap"]')));
          out.push({ at: h1, title: text(h1), price, seller, marketplace: Boolean(seller && !/walmart/i.test(seller)), hint: null });
        }
        return out;
      },
    },
  };

  /** Any other page: the lines of what's selected, one title a line. */
  function selectedLines() {
    const s = String(window.getSelection() ?? '');
    return s
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2 && l.length <= 200)
      .slice(0, 100)
      .map((title) => ({ at: null, title, price: null, seller: null, marketplace: false, hint: consoleIn(document.title) }));
  }

  const css = `
    :host { all: initial; }
    .b { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 4px 0 2px; padding: 3px 6px 3px 8px; border-radius: 999px;
         font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; background: #fff; border: 1px solid #d8ddd9;
         box-shadow: 0 1px 2px rgba(0,0,0,.06); cursor: default; }
    .b.own { background: #f3faf5; border-color: #b8dcc4; }
    .muted { color: #5c6a60; font-weight: 500; }
    .flag { padding: 0 6px; border-radius: 4px; background: #fff3cd; color: #7a5300; font-weight: 600; }
    .flag.bad { background: #ffe3e3; color: #9b1c1c; }
    button { all: unset; cursor: pointer; padding: 1px 7px; border-radius: 999px; background: #eef1ef; color: #1f2a22; font-weight: 600;
             display: inline-flex; align-items: center; gap: 3px; }
    button:hover { background: #dfe5e1; }
    button:focus-visible { outline: 2px solid #2f7d4f; outline-offset: 1px; }
    .stash { gap: 4px; padding: 1px 4px; border-radius: 6px; background: transparent; }
    .stash:hover { background: #eef1ef; }
    .stash svg { display: block; }
    .acorns { color: #2b6e46; }
    .sure { min-width: 10px; justify-content: center; padding: 1px 6px; font-weight: 800; }
    .sure.H { background: #e3f4e8; color: #1d7f44; } .sure.M { background: #fbf0d3; color: #8a6200; } .sure.L { background: #fde4e1; color: #b3261e; }
  `;
  const popCss = `
    .p { width: 300px; padding: 12px 14px; border-radius: 12px; background: #fff; border: 1px solid #d8ddd9; box-shadow: 0 8px 24px rgba(0,0,0,.18);
         font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; }
    .h { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    td, th { padding: 3px 0; text-align: left; vertical-align: top; } th { font-weight: 500; color: #5c6a60; padding-right: 10px; white-space: nowrap; }
    td.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    a { color: #2b7a4b; font-weight: 600; text-decoration: none; } a:hover { text-decoration: underline; }
    .o { font-size: 12px; color: #5c6a60; margin-top: 4px; }
    .opt { display: flex; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 6px 9px; margin: 2px 0; border-radius: 8px; background: #f4f6f5; }
    .opt.on { background: #dff2e6; box-shadow: inset 0 0 0 1px #8fcca6; }
    .opt[disabled] { opacity: .5; cursor: wait; }
  `;

  const state = { rows: [], hosts: [], bar: null, pop: null, drawer: null, store: 'this page', preferences: [] };

  function clear() {
    for (const h of state.hosts) h.remove();
    state.hosts = [];
    state.rows = [];
    state.pop?.remove();
    state.pop = null;
    state.bar?.remove();
    state.bar = null;
    closeDrawer();
  }

  const LEVEL = { sure: 'H', likely: 'M', unsure: 'L' };
  const LEVEL_WORD = { H: 'High', M: 'Medium', L: 'Low' };

  /** The chest's hover text: yours here, yours elsewhere (which consoles), or not. */
  function chestLabel(r) {
    if (r.chest === 'own') return 'Stash (owned)';
    if (r.chest === 'elsewhere') return `Stash (owned on ${r.ownedOn.join(', ')}, not this console)`;
    return 'Stash (unowned)';
  }

  // One listing's badge: the chest and console marks (they open the game's drawer), the acorns (your preference), the
  // copy's flags, PriceCharting, and how sure the answer is (H, M, L).
  function badge(row) {
    const r = row.result;
    const host = document.createElement('span');
    host.className = 'squirrelcade-deal';
    host.style.display = 'block';
    const root = host.attachShadow({ mode: 'open' });
    const level = LEVEL[r.sure];
    const marks = (r.marks ?? []).map((m) => m.svg).join('');
    const acornsButton = r.preference
      ? `<button type="button" class="acorns" title="Your acorns for it: change your preference">${acorn()} ${r.wishlist ? `${r.wishlist.acorns} <span class="muted">${esc(r.wishlist.priority)}</span>` : '<span class="muted">Acorns</span>'}${r.preference.value ? ` <span class="muted">· ${esc(r.preference.value)}</span>` : ''}</button>`
      : '';
    const flags = [...r.flags.map((f) => `<span class="flag${f === 'game-key-card' ? ' bad' : ''}">${esc(FLAGS[f] ?? f)}</span>`), row.marketplace ? `<span class="flag" title="${esc(row.seller)}">Marketplace seller</span>` : ''].join('');
    const label = `${chestLabel(r)}: open it in Squirrelcade`;
    root.innerHTML =
      `<style>${css}</style><span class="b${r.chest === 'own' ? ' own' : ''}">` +
      `<button type="button" class="stash" title="${esc(label)}" aria-label="${esc(label)}">${chest(r.chest)}${marks}</button>` +
      `${acornsButton}${flags}<button type="button" class="pc" title="PriceCharting's prices">PriceCharting</button>` +
      `<button type="button" class="sure ${level}" title="How sure: ${LEVEL_WORD[level]}" aria-label="How sure: ${LEVEL_WORD[level]}">${level}</button></span>`;
    // The badge sits inside the store's link: its clicks stay with it.
    host.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    const on = (sel, fn) =>
      root.querySelector(sel)?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(e.currentTarget);
      });
    on('.stash', () => openDrawer(row));
    on('.pc', (b) => showPrices(row, b));
    on('.acorns', (b) => showAcorns(row, b));
    on('.sure', (b) => showSure(row, b));
    return host;
  }

  /** A small window by a badge's button; `draw` fills it. Esc or a click elsewhere closes it. */
  function popup(button, heading) {
    state.pop?.remove();
    const host = document.createElement('div');
    host.className = 'squirrelcade-deal';
    const rect = button.getBoundingClientRect();
    Object.assign(host.style, { position: 'absolute', zIndex: '2147483647', left: `${Math.max(8, rect.left + window.scrollX - 120)}px`, top: `${rect.bottom + window.scrollY + 6}px` });
    const root = host.attachShadow({ mode: 'open' });
    const draw = (body) => {
      root.innerHTML = `<style>${css}${popCss}</style><div class="p" role="dialog" aria-label="Squirrelcade"><div class="h"><span>${heading}</span><button type="button" class="x" aria-label="Close">×</button></div>${body}</div>`;
      root.querySelector('.x').addEventListener('click', () => host.remove());
      // Near the bottom of the window, it opens above the button instead.
      host.style.top = `${rect.bottom + window.scrollY + 6}px`;
      const box = host.getBoundingClientRect();
      if (box.bottom > window.innerHeight - 8 && rect.top - box.height - 6 > 0) host.style.top = `${rect.top + window.scrollY - box.height - 6}px`;
      return root;
    };
    document.body.appendChild(host);
    state.pop = host;
    const close = (e) => {
      if ((e.type === 'keydown' && e.key !== 'Escape') || (e.type === 'mousedown' && e.composedPath().includes(host))) return;
      host.remove();
      document.removeEventListener('keydown', close, true);
      document.removeEventListener('mousedown', close, true);
    };
    document.addEventListener('keydown', close, true);
    document.addEventListener('mousedown', close, true);
    return { host, draw };
  }

  const gameHeading = (r) => `${esc(r.title)}${r.platform ? ` <span class="muted">${esc(r.platform)}</span>` : ''}`;

  /** How sure the answer is, and why, with what Squirrelcade read from the listing. */
  function showSure(row, button) {
    const r = row.result;
    const level = LEVEL[r.sure];
    const answer =
      r.chest === 'own'
        ? 'You have it on this console'
        : r.chest === 'elsewhere'
          ? `You have it on ${esc(r.ownedOn.join(', '))}, not this console`
          : r.answer === 'maybe'
            ? `Maybe: close to your ${esc(r.match?.title ?? '')}`
            : 'You don’t have it';
    const rows = [
      ['Confidence', `<b>${LEVEL_WORD[level]}</b>`],
      ['Answer', answer],
      ['Why', esc(r.why.replace(/^(Sure|Pretty sure|Not sure): /, ''))],
      r.match ? ['Matched', `${esc(r.match.title)} <span class="muted">(${esc(r.match.platform)}, ${Math.round(r.match.confidence * 100)}%)</span>`] : null,
      r.valueCents !== null ? ['Your copy', money(r.valueCents)] : null,
      r.wishlist ? ['Wishlist', `${r.wishlist.acorns} acorns, ${esc(r.wishlist.priority)}${r.wishlist.rank ? `, #${r.wishlist.rank}` : ''}`] : null,
      ['Read as', `${esc(r.title)} <span class="muted">· ${esc(r.platform ?? 'no console')}</span>`],
      r.flags.length || row.marketplace ? ['Flags', esc([...r.flags.map((f) => FLAGS[f] ?? f), row.marketplace ? `marketplace seller (${row.seller})` : ''].filter(Boolean).join(', '))] : null,
    ].filter(Boolean);
    popup(button, gameHeading(r)).draw(`<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table><div class="o">The chest opens it in Squirrelcade.</div>`);
  }

  /** Your preference for the game (its acorns): picked here, kept in Squirrelcade, then the listing is checked again. */
  function showAcorns(row, button) {
    const r = row.result;
    const { draw } = popup(button, gameHeading(r));
    const current = r.preference?.value ?? 'No Adjustment';
    const fmt = (p) => (p.acorns === null || p.acorns === 0 ? '' : `${p.acorns > 0 ? '+' : ''}${p.acorns}`);
    const render = (message = '') => {
      const root = draw(
        `<div class="muted" style="margin-bottom:6px">${r.wishlist ? `${r.wishlist.acorns} acorns now (${esc(r.wishlist.priority)}).` : 'Not on your wishlist now.'} Your preference adds or takes acorns:</div>` +
          state.preferences.map((p) => `<button type="button" class="opt${current === p.name ? ' on' : ''}" data-p="${esc(p.name)}"><span>${esc(p.name)}</span><span class="muted">${fmt(p)}</span></button>`).join('') +
          (message ? `<div class="o">${esc(message)}</div>` : ''),
      );
      root.querySelectorAll('.opt').forEach((b) =>
        b.addEventListener('click', async () => {
          root.querySelectorAll('.opt').forEach((x) => x.setAttribute('disabled', ''));
          const name = b.getAttribute('data-p');
          const res = await chrome.runtime.sendMessage({
            type: 'api',
            url: '/api/v1/wishlist/preferences',
            method: 'PUT',
            contentType: 'application/json',
            body: JSON.stringify({ platformKey: r.preference.platformKey, title: r.preference.title, preference: name === 'No Adjustment' ? null : name }),
          });
          if (!res || res.status >= 300) {
            render('Squirrelcade didn’t take it. Try again in a moment.');
            return;
          }
          // The listing asked again: its acorns, priority and preference as Squirrelcade has them now.
          const again = await chrome.runtime.sendMessage({ type: 'check', items: [{ title: row.title, platform: row.hint }] });
          if (again?.results?.[0] && row.host) {
            row.result = again.results[0];
            const fresh = badge(row);
            row.host.replaceWith(fresh);
            state.hosts[state.hosts.indexOf(row.host)] = fresh;
            row.host = fresh;
          }
          state.pop?.remove();
        }),
      );
    };
    render();
  }

  /** Squirrelcade's own game drawer, sliding over the page (in a frame of the extension's, so the page can't touch it). */
  async function openDrawer(row) {
    const target = row.result.drawer;
    if (!target) return;
    closeDrawer();
    const { server } = await chrome.storage.local.get(['server']);
    const frame = document.createElement('iframe');
    frame.className = 'squirrelcade-deal';
    frame.title = 'Squirrelcade';
    frame.src = chrome.runtime.getURL(`drawer/drawer.html?${new URLSearchParams({ game: `${target.platformKey}|${target.title}`, server: server ?? '' })}`);
    // Dark like the drawer inside it: a frame whose page has another color scheme gets an opaque backdrop.
    Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', border: '0', zIndex: '2147483647', background: 'transparent', colorScheme: 'dark' });
    frame.setAttribute('allowtransparency', 'true');
    document.body.appendChild(frame);
    state.drawer = frame;
  }
  function closeDrawer() {
    state.drawer?.remove();
    state.drawer = null;
  }
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'squirrelcade-drawer-close' && state.drawer && e.source === state.drawer.contentWindow) closeDrawer();
  });

  // The deal meter of the game-of-the-day email: the listing's price against the usual price (PriceCharting's new
  // price plus typical shipping, as the email reckons it), in five bands with "today" over the one it falls in.
  const SHIPPING = 500;
  const BANDS = [
    { name: 'Overpriced', color: '#c9473d', from: 0.2 },
    { name: 'Pricey', color: '#e2823f', from: 0.05 },
    { name: 'Fair', color: '#d9ad2e', from: -0.15 },
    { name: 'Deal', color: '#58ad63', from: -0.35 },
    { name: 'Steal', color: '#1d7f44', from: -Infinity },
  ];
  function dealMeter(price, newCents) {
    if (price === null || price === undefined || !newCents) return '';
    const usual = newCents + SHIPPING;
    const off = (price - usual) / usual;
    const at = BANDS.findIndex((b) => off >= b.from);
    const pct = Math.round(Math.abs(off) * 100);
    const delta = pct === 0 ? 'right at' : `${pct}% ${off < 0 ? 'under' : 'over'}`;
    // Shown left to right from Overpriced to Steal, as in the email.
    const cells = BANDS.map((b, i) => {
      const on = i === at;
      const radius = i === 0 ? 'border-radius:5px 0 0 5px;' : i === BANDS.length - 1 ? 'border-radius:0 5px 5px 0;' : '';
      return `<div style="flex:1;text-align:center"><div style="font-size:11px;font-weight:700;height:15px">${on ? '▼ today' : ''}</div><div style="height:${on ? 14 : 10}px;margin-top:${on ? 0 : 2}px;background:${b.color};${radius}"></div><div style="font-size:10.5px;padding-top:4px;${on ? 'font-weight:700;color:#1f2a22' : 'color:#8a958d'}">${b.name}</div></div>`;
    }).join('');
    const tone = at >= 2 ? '#2b7a4b' : '#c9473d';
    return `<div style="margin:2px 0 10px"><div style="display:flex;gap:3px;align-items:flex-end">${cells}</div><div style="font-size:12px;margin-top:6px;color:#5c6a60"><b style="color:${tone}">${delta}</b> the usual ${money(usual)} (new ${money(newCents)} + ${money(SHIPPING)} typical shipping)</div></div>`;
  }

  async function showPrices(row, button) {
    const r = row.result;
    const { host, draw } = popup(button, gameHeading(r));
    draw('<div class="muted">Reading PriceCharting…</div>');
    const answer = await chrome.runtime.sendMessage({ type: 'prices', url: r.priceChartingUrl, title: r.title, platform: r.platform });
    if (!host.isConnected) return;
    const best = answer?.products?.[0];
    if (!best) {
      draw(`<div class="muted">${esc(answer?.error ?? 'PriceCharting has no match.')}</div><div style="margin-top:8px"><a href="${esc(r.priceChartingUrl)}" target="_blank" rel="noopener">Search PriceCharting ›</a></div>`);
      return;
    }
    row.prices = best;
    const others = answer.products.slice(1).map((p) => `<div class="o"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> · ${esc(p.console)}: ${money(p.loose)} / ${money(p.cib)} / ${money(p.new)}</div>`).join('');
    draw(
      `<div class="muted">${esc(best.title)} · ${esc(best.console)}</div>` +
        `<table><tr><th>Loose</th><td class="n">${money(best.loose)}</td></tr><tr><th>Complete (CIB)</th><td class="n">${money(best.cib)}</td></tr><tr><th>New</th><td class="n">${money(best.new)}</td></tr>` +
        (row.price !== null ? `<tr><th>This listing</th><td class="n">${money(row.price)}</td></tr>` : '') +
        (r.valueCents !== null ? `<tr><th>Your copy</th><td class="n">${money(r.valueCents)}</td></tr>` : '') +
        `</table>${dealMeter(row.price, best.new)}<a href="${esc(best.url)}" target="_blank" rel="noopener">Open on PriceCharting ›</a>${others ? `<div style="margin-top:8px" class="muted">Other matches</div>${others}` : ''}`,
    );
  }

  function drawBar(message, opts = {}) {
    if (!state.bar) {
      state.bar = document.createElement('div');
      state.bar.className = 'squirrelcade-deal';
      Object.assign(state.bar.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647' });
      state.bar.attachShadow({ mode: 'open' });
      document.body.appendChild(state.bar);
    }
    const root = state.bar.shadowRoot;
    root.innerHTML = `<style>${css}
      .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; max-width: min(560px, calc(100vw - 32px)); padding: 8px 10px 8px 12px; border-radius: 12px;
             background: #fff; border: 1px solid #d8ddd9; box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; }
      .t { display: inline-flex; align-items: center; gap: 6px; }
    </style><div class="bar" role="status"><span class="t">${chest(true, 15)} ${message}</span>${opts.options ? '<button type="button" class="opt">Options</button>' : ''}${state.rows.length ? '<button type="button" class="copy">Copy for Claude</button>' : ''}<button type="button" class="again">Check again</button><button type="button" class="close" aria-label="Clear the badges">×</button></div>`;
    root.querySelector('.opt')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'options' }));
    root.querySelector('.copy')?.addEventListener('click', copyForClaude);
    root.querySelector('.again').addEventListener('click', scan);
    root.querySelector('.close').addEventListener('click', clear);
  }

  /** The page's results as a short table to paste into a chat with Claude. */
  async function copyForClaude() {
    const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    const lines = [
      `Squirrelcade deal check: ${state.store}, ${when}`,
      location.href,
      '',
      '| Listing | Game | Console | Price | Seller | Mine? | Sure | Acorns | PriceCharting loose / CIB / new | Flags |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...state.rows.map((row) => {
        const r = row.result;
        const mine = r.answer === 'own' ? 'yes' : r.answer === 'elsewhere' ? `on ${r.ownedOn.join(', ')}` : r.answer === 'maybe' ? `maybe (${r.match?.title ?? ''})` : 'no';
        const pc = row.prices ? `${money(row.prices.loose)} / ${money(row.prices.cib)} / ${money(row.prices.new)}` : '';
        const flags = [...r.flags.map((f) => FLAGS[f] ?? f), row.marketplace ? 'marketplace seller' : ''].filter(Boolean).join(', ');
        return `| ${cell(row.title)} | ${cell(r.title)} | ${cell(r.platform ?? '?')} | ${row.price !== null ? money(row.price) : ''} | ${cell(row.seller ?? '')} | ${cell(mine)} | ${SURE[r.sure].word} | ${r.wishlist ? `${r.wishlist.acorns} (${r.wishlist.priority})` : ''} | ${pc} | ${cell(flags)} |`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      drawBar(`Copied ${state.rows.length} games. Paste them into Claude.`);
    } catch {
      drawBar('The browser wouldn’t let me copy. Click the page once, then try again.');
    }
  }

  async function scan() {
    clear();
    const reader = Object.values(READERS).find((r) => r.test());
    state.store = reader?.name ?? location.hostname;
    let listings = reader ? reader.read() : [];
    if (listings.length === 0) listings = selectedLines();
    listings = listings.filter((l) => l.title && l.title.length >= 2);
    if (listings.length === 0) {
      drawBar(reader ? 'No games found on this page.' : 'Select the titles to check, then press the button again.');
      return;
    }
    drawBar(`Checking ${listings.length} listings…`);
    // Each title once, with its console.
    const keyOf = (l) => `${l.title}|${l.hint ?? ''}`;
    const unique = [...new Map(listings.map((l) => [keyOf(l), { title: l.title, platform: l.hint }])).entries()];
    const answer = await chrome.runtime.sendMessage({ type: 'check', items: unique.map(([, i]) => i) });
    if (!answer || answer.error) {
      drawBar(esc(answer?.error ?? 'Squirrelcade didn’t answer.'), { options: answer?.options });
      return;
    }
    state.preferences = answer.preferences ?? [];
    const byKey = new Map(unique.map(([k], i) => [k, answer.results[i]]));
    let leftOut = 0;
    for (const l of listings) {
      const row = { ...l, result: byKey.get(keyOf(l)) };
      if (!row.result) continue;
      if (notAGame(row)) {
        leftOut++;
        continue;
      }
      state.rows.push(row);
      if (row.at) {
        const host = badge(row);
        row.host = host;
        row.at.after(host);
        state.hosts.push(host);
      }
    }
    const games = new Map(state.rows.map((r) => [`${r.result.title}|${r.result.platformKey}`, r.result]));
    const mine = [...games.values()].filter((r) => r.answer === 'own').length;
    const wanted = [...games.values()].filter((r) => r.answer !== 'own' && r.wishlist).length;
    const unsure = [...games.values()].filter((r) => r.sure === 'unsure').length;
    const list = state.hosts.length === 0 ? ' (selected lines: the table is in Copy for Claude)' : '';
    const others = leftOut ? ` · ${leftOut} not games left out` : '';
    drawBar(`${games.size} games: ${mine} yours, ${wanted} on your wishlist${unsure ? `, ${unsure} to check` : ''}${others}${list}`);
  }

  // Accessories and hardware a store lists among its games (a stand, a case, grips, a console bundle): left out when
  // nothing of yours or of your wishlist matches them, so a game with one of these words in its name still shows.
  const ACCESSORY =
    /\b(stands?|cases?|carrying|holders?|chargers?|charging|charge|cables?|cords?|grips?|skins?|decals?|protectors?|tempered glass|docks?|docking|adapters?|headsets?|headphones?|earbuds|memory card|micro ?sd|sd card|bags?|pouch|sleeves?|covers?|shell|thumb ?sticks?|steering wheel|rackets?|straps?|lanyards?|memberships?|subscriptions?|gift card|eshop card|amiibo|mounts?|cooling fan|batter(y|ies)|power bank|keyboard|mouse|plush|poster|t-?shirt|controllers?|joy[- ]?cons?|gamepads?|consoles?)\b/i;
  const HARDWARE = /^((restored|refurbished|renewed|pre-?owned)\s+)?(nintendo switch( 2| oled| lite)?|playstation ?[45]( pro| slim)?|xbox series [xs]|xbox one)\s*(\+|console|system|bundle|with\b|\(refurbished\))/i;
  // Words no game's name has (an amiibo, a controller): out even when a game of yours comes close ("amiibo - Riju: The
  // Legend of Zelda Series" is close to The Legend of Zelda), unless the listing is one you own.
  const NEVER_A_GAME = /\b(amiibo|action figures?|figurines?|controllers?|gamepads?|joy[- ]?cons?|headsets?|gift card|eshop card|memberships?|subscriptions?|plush)\b/i;
  function notAGame(row) {
    const r = row.result;
    if (r.answer === 'own') return false;
    if (NEVER_A_GAME.test(r.title) || HARDWARE.test(row.title)) return true;
    if (r.answer !== 'need' || r.wishlist || r.match) return false;
    // The game's name as Squirrelcade read it, not the store's whole line: Walmart's lines go on ("...for Nintendo
    // Switch console") and made Pokémon Legends: Arceus look like a console.
    return ACCESSORY.test(r.title) || HARDWARE.test(r.title) || HARDWARE.test(row.title);
  }

  window.__squirrelcadeDeal = { scan, clear };
  scan();
})();
