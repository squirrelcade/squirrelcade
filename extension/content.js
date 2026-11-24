// Squirrelcade Deal check, on the page (D245). Put here by the toolbar button, only on the tab it was pressed on:
// it reads the listings on this page (nothing else: no other pages, no scrolling or paging), asks Squirrelcade about
// them through the extension, and puts a badge on each: the Stash's chest (filled: yours; grey: not), a dot for how
// sure that is (green, yellow, red), its acorns when it's on your wishlist, and PriceCharting's prices on a click.
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

  // The Stash's chest and the acorn, exactly as Squirrelcade draws them (apps/web/src/Acorn.tsx).
  const chest = (owned, size = 14) =>
    `<svg viewBox="0 0 7 6" width="${Math.round((size * 7) / 6)}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="Stash (${owned ? 'owned' : 'unowned'})"><title>Stash (${owned ? 'owned' : 'unowned'})</title>` +
    `<path d="M1 0h5v1H1zM0 1h1v5H0zM6 1h1v5H6zM1 2h2v1H1zM4 2h2v1H4zM1 5h5v1H1z" fill="${owned ? '#6b3a10' : OFF}"/>` +
    (owned ? '<path d="M1 1h5v1H1zM1 3h2v2H1zM4 3h2v2H4zM3 4h1v1H3z" fill="#c27a3f"/>' : '') +
    `<path d="M3 2h1v2H3z" fill="${owned ? '#e9b44c' : OFF}"/></svg>`;
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
          const h2 = card.querySelector('h2');
          if (!h2) continue;
          const title = (h2.getAttribute('aria-label') || text(h2)).replace(/^Sponsored Ad\s*[-–—]\s*/i, '').trim();
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
    .b { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 4px 0 2px; padding: 3px 8px; border-radius: 999px;
         font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; background: #fff; border: 1px solid #d8ddd9;
         box-shadow: 0 1px 2px rgba(0,0,0,.06); cursor: default; }
    .b.own { background: #f3faf5; border-color: #b8dcc4; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .acorns { display: inline-flex; align-items: center; gap: 3px; color: #2b6e46; }
    .muted { color: #5c6a60; font-weight: 500; }
    .flag { padding: 0 6px; border-radius: 4px; background: #fff3cd; color: #7a5300; font-weight: 600; }
    .flag.bad { background: #ffe3e3; color: #9b1c1c; }
    button { all: unset; cursor: pointer; padding: 1px 7px; border-radius: 999px; background: #eef1ef; color: #1f2a22; font-weight: 600; }
    button:hover { background: #dfe5e1; }
    button:focus-visible { outline: 2px solid #2f7d4f; outline-offset: 1px; }
  `;

  const state = { rows: [], hosts: [], bar: null, pop: null, store: 'this page' };

  function clear() {
    for (const h of state.hosts) h.remove();
    state.hosts = [];
    state.rows = [];
    state.pop?.remove();
    state.pop = null;
    state.bar?.remove();
    state.bar = null;
  }

  function badge(row) {
    const r = row.result;
    const host = document.createElement('span');
    host.className = 'squirrelcade-deal';
    host.style.display = 'block';
    const root = host.attachShadow({ mode: 'open' });
    const own = r.answer === 'own';
    const sure = SURE[r.sure];
    const words =
      r.answer === 'own'
        ? `Yours${r.valueCents !== null ? ` <span class="muted">worth ${money(r.valueCents)}</span>` : ''}`
        : r.answer === 'elsewhere'
          ? `<span class="muted">On ${esc(r.ownedOn.slice(0, 2).join(', '))}</span>`
          : r.answer === 'maybe'
            ? `<span class="muted">Close to ${esc(r.match?.title ?? 'one of yours')}</span>`
            : r.wishlist
              ? ''
              : '<span class="muted">Not yours</span>';
    const wish = r.wishlist ? `<span class="acorns" title="On your wishlist (${esc(r.wishlist.platform)})">${acorn()} ${r.wishlist.acorns} <span class="muted">${esc(r.wishlist.priority)}</span></span>` : '';
    const flags = [...r.flags.map((f) => `<span class="flag${f === 'game-key-card' ? ' bad' : ''}">${esc(FLAGS[f] ?? f)}</span>`), row.marketplace ? `<span class="flag" title="${esc(row.seller)}">Marketplace seller</span>` : ''].join('');
    root.innerHTML = `<style>${css}</style><span class="b${own ? ' own' : ''}">${chest(own)}<span class="dot" style="background:${sure.color}" title="${esc(r.why)}" aria-label="${esc(r.why)}"></span>${words}${wish}${flags}<button type="button" class="pc" title="PriceCharting's prices">PriceCharting</button></span>`;
    // The badge sits inside the store's link: its clicks stay with it.
    host.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    root.querySelector('.pc').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPrices(row, e.currentTarget);
    });
    return host;
  }

  async function showPrices(row, button) {
    state.pop?.remove();
    const host = document.createElement('div');
    host.className = 'squirrelcade-deal';
    const rect = button.getBoundingClientRect();
    Object.assign(host.style, { position: 'absolute', zIndex: '2147483647', left: `${Math.max(8, rect.left + window.scrollX - 120)}px`, top: `${rect.bottom + window.scrollY + 6}px` });
    const root = host.attachShadow({ mode: 'open' });
    const r = row.result;
    const draw = (body) => {
      root.innerHTML = `<style>${css}
        .p { width: 300px; padding: 12px 14px; border-radius: 12px; background: #fff; border: 1px solid #d8ddd9; box-shadow: 0 8px 24px rgba(0,0,0,.18);
             font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; }
        .h { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        td, th { padding: 3px 0; text-align: left; } th { font-weight: 500; color: #5c6a60; } td.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
        a { color: #2b7a4b; font-weight: 600; text-decoration: none; } a:hover { text-decoration: underline; }
        .o { font-size: 12px; color: #5c6a60; margin-top: 4px; }
      </style><div class="p" role="dialog" aria-label="PriceCharting prices"><div class="h"><span>${esc(r.title)}${r.platform ? ` <span class="muted">${esc(r.platform)}</span>` : ''}</span><button type="button" class="x" aria-label="Close">×</button></div>${body}</div>`;
      root.querySelector('.x').addEventListener('click', () => host.remove());
    };
    draw('<div class="muted">Reading PriceCharting…</div>');
    document.body.appendChild(host);
    state.pop = host;
    // Esc or a click elsewhere closes it.
    const close = (e) => {
      if ((e.type === 'keydown' && e.key !== 'Escape') || (e.type === 'mousedown' && e.composedPath().includes(host))) return;
      host.remove();
      document.removeEventListener('keydown', close, true);
      document.removeEventListener('mousedown', close, true);
    };
    document.addEventListener('keydown', close, true);
    document.addEventListener('mousedown', close, true);
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
        `</table><a href="${esc(best.url)}" target="_blank" rel="noopener">Open on PriceCharting ›</a>${others ? `<div style="margin-top:8px" class="muted">Other matches</div>${others}` : ''}`,
    );
    // Near the bottom of the window, it opens above the button instead.
    const box = host.getBoundingClientRect();
    if (box.bottom > window.innerHeight - 8 && rect.top - box.height - 6 > 0) host.style.top = `${rect.top + window.scrollY - box.height - 6}px`;
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
    const byKey = new Map(unique.map(([k], i) => [k, answer.results[i]]));
    for (const l of listings) {
      const row = { ...l, result: byKey.get(keyOf(l)) };
      if (!row.result) continue;
      state.rows.push(row);
      if (row.at) {
        const host = badge(row);
        row.at.after(host);
        state.hosts.push(host);
      }
    }
    const games = new Map(state.rows.map((r) => [`${r.result.title}|${r.result.platformKey}`, r.result]));
    const mine = [...games.values()].filter((r) => r.answer === 'own').length;
    const wanted = [...games.values()].filter((r) => r.answer !== 'own' && r.wishlist).length;
    const unsure = [...games.values()].filter((r) => r.sure === 'unsure').length;
    const list = state.hosts.length === 0 ? ' (selected lines: the table is in Copy for Claude)' : '';
    drawBar(`${games.size} games: ${mine} yours, ${wanted} on your wishlist${unsure ? `, ${unsure} to check` : ''}${list}`);
  }

  window.__squirrelcadeDeal = { scan, clear };
  scan();
})();
