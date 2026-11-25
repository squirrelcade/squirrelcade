// Squirrelcade Deal check, on the page (D245). Put here by the toolbar button, only on the tab it was pressed on:
// it reads the listings on this page (nothing else: no other pages, no scrolling or paging), asks Squirrelcade about
// them through the extension, and puts a badge on each: the Stash's chest (filled: yours; half: yours on another console;
// grey: not) and the console marks, which open the game's drawer; its acorns, a button to change your preference;
// PriceCharting's prices and the deal meter; and H, M or L for how sure the answer is, with why.
// On the stores it reads it runs by itself (Auto, each store's own switch in the toolbar button's window) and checks
// new results as they load; the window's Check again checks the page afresh, and on any other page reads the selection.
(() => {
  if (window.__squirrelcadeDeal) {
    window.__squirrelcadeManual = false;
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

  // Another region's release named in brackets ("(JPN Import - Multi-Language)", "[Asia English]", "(PAL)", "(EU
  // Version)"): taken out of the title so it matches the game itself, and shown as an Import flag. A region-free
  // console's import is the same game in your collection (Squirrelcade's region settings decide the rest).
  const REGION = /\s*[([]\s*((?:jpn?|japan(?:ese)?|asia(?:n)?|eur?(?:ope(?:an)?)?|uk|pal|hk|hong kong|korea(?:n)?|chinese|aus(?:tralian)?)\b[^)\]]*|[^)\]]*\bimport\b[^)\]]*)[)\]]/i;
  // A collector line's number before the title ("Switch Limited Run #94: Celeste", "SRG#158: ...", "[Deluxe Edition] DE#9:
  // ..."): the game is what follows (Squirrelcade's sets know the lines).
  const LINE_NUMBER = /^(?:\[[^\]]{2,30}\]\s*)?(?:(?:switch|nsw|ps[345]|ps vita|vita|xbox one|xbox series x(?:\|s)?|pc)\s+)?(?:limited run|lrg|srg|srgc|de|srg deluxe|strictly limited|sl)\s*#\s*\d+\s*[:\-–]\s*/i;
  const KEY_SUFFIX = /\s+(?:(EU|US|UK|NA|USA|Global|Asia|ROW|LATAM)\s+)?(Nintendo Switch 2|Nintendo Switch|Xbox Series X\|S|Xbox One|Xbox|PS5|PS4|PlayStation 5|PlayStation 4|Steam)?\s*(?:CD Key|Key|Digital Code|Account)$/i;
  const PRINTING = /\s*[-–:,(]?\s*\b(goty|game of the year(?: edition)?|greatest hits|platinum hits|player'?s choice|nintendo selects|playstation hits|essentials)\b\s*\)?/gi;
  function withoutRegion(listing) {
    // A console's short code before the title ("PS3 Teslagrad (Sony PlayStation 3, 2015)", as eBay sellers write): the
    // console, kept as the hint. Only codes no game's name starts with: "Nintendo Switch Sports" and "NES Remix" stay.
    // Sellers' decoration ("** Factory Sealed **", "~~", "!!!") isn't words; a maker and its console before the title
    // ("Sony PlayStation 3 PS3 Yakuza 4", "Microsoft Xbox 360 Halo 3") is the console. A game's name never starts with both.
    listing = { ...listing, title: listing.title.replace(/[*~!]{2,}|\s[*~!]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim() };
    // A copy's condition ("CIB / Complete In Case with Manual", "Tested & Working", "Disc Only"): the copy, not the game.
    listing = {
      ...listing,
      title: listing.title
        .replace(/\s*[/|]\s*(?=(?:cib|complete|with|w\/|tested|disc|game only|manual|case)\b)/gi, ' ')
        .replace(/\b(?:cib|complete in (?:box|case)|complete(?=\s*(?:$|[,/|(\-–]))|(?:with|w\/|includes?) (?:the )?(?:manual|case|box)(?: and (?:manual|case|box))?|tested(?: (?:and|&) working)?|works great|working|disc only|game only|cartridge only|cart only|no manual|great condition|good condition|excellent condition|pre-?owned|used)\b/gi, ' ')
        .replace(/\b(?:untested|ntsc(?:-u\/c|-u|-j)?|(?:rated )?(?:e|t|m|e10\+?)-(?:everyone(?: 10\+)?|teen|mature(?: 17\+)?))(?=\s|$|[,)\-–])/gi, ' ')
        .replace(/\(\s*\)|\[\s*\]/g, ' ')
        .replace(/[\s\-–/|,]+$/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    };
    // A reprint's label ("GOTY Greatest Hits", "Platinum Hits", "Player's Choice") is the same game: in brackets, where
    // Squirrelcade reads it as a printing ("[Game of the Year]" is your GOTY copy), not as words of the name.
    const labels = [];
    const unlabelled = listing.title.replace(PRINTING, (m, label) => {
      labels.push(/^goty$/i.test(label) ? 'Game of the Year' : label);
      return ' ';
    });
    if (labels.length) listing = { ...listing, title: `${unlabelled.replace(/[\s\-–/|,:]+$/, '').replace(/\s+/g, ' ').trim()} [${labels.join(' ')}]` };
    const maker = /^(?:sony\s+(?:playstation\s?[1-5]|ps\s?vita|playstation\s+vita)|microsoft\s+xbox(?:\s+(?:360|one|series\s+[xs](?:\s?\|\s?s)?))?|nintendo\s+(?:gamecube|wii\s?u|wii|3ds|ds|64))\b[\s:\-–|]+(?=\S)/i.exec(listing.title);
    if (maker) listing = { ...listing, title: listing.title.slice(maker[0].length), hint: listing.hint ?? consoleIn(maker[0]) };
    const lead = /^(ps[1-5]|ps ?vita|nsw2?|ns[12]|x360|xb1|xbo|xsx)\b[\s:\-–|]+(?=\S)/i.exec(listing.title);
    if (lead) listing = { ...listing, title: listing.title.slice(lead[0].length), hint: listing.hint ?? consoleIn(lead[1]) ?? lead[1] };
    // A collector number at the end ("PERSONA 4 GOLDEN (STANDARD - SWITCH) LRG #214"): not the game's words.
    listing = { ...listing, title: listing.title.replace(/\s+(?:LRG|SRG|Limited Run(?: Games)?|Strictly Limited)\s*#\s*\d+\s*$/i, '') };
    const line = LINE_NUMBER.exec(listing.title);
    // The console the line's number names ("Switch Limited Run #94") stays as the hint.
    if (line) listing = { ...listing, title: listing.title.replace(LINE_NUMBER, ''), hint: listing.hint ?? consoleIn(line[0]) };
    // A key shop's title ("Mario Kart World EU Nintendo Switch 2 CD Key"): the game, its console as the hint, "[Digital
    // Code]" for Squirrelcade's flag, and a region other than the US as an import.
    const key = KEY_SUFFIX.exec(listing.title);
    if (key) {
      const region = key[1] && !/^(us|na|usa)$/i.test(key[1]) ? key[1] : listing.region;
      listing = { ...listing, title: `${listing.title.slice(0, key.index).trim()} [Digital Code]`, hint: listing.hint ?? consoleIn(key[2] ?? '') ?? key[2] ?? null, region };
    }
    // Language and cover tags (Play-Asia's "(Multi-Language) (Cover - Asian)"): not the game's words; an Asian or Japanese
    // cover is another region's release.
    const cover = /[([]\s*cover\s*-\s*(asian?|japanese|chinese|korean)\s*[)\]]/i.exec(listing.title);
    const cleaned = listing.title.replace(/\s*[([]\s*(?:multi-?language|multi-?lingual|english(?: (?:subs?|version|cover))?|cover\s*-\s*[^)\]]+|(?:chinese|japanese|korean)(?: subs?)?)\s*[)\]]/gi, '').replace(/\s+/g, ' ').trim();
    if (cleaned !== listing.title) listing = { ...listing, title: cleaned, region: listing.region ?? (cover ? `${cover[1]} cover` : undefined) };
    const m = REGION.exec(listing.title);
    if (!m) return listing;
    return { ...listing, title: (listing.title.slice(0, m.index) + listing.title.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), region: m[1].trim() };
  }

  // The Stash's chest and the acorn, exactly as Squirrelcade draws them (apps/web/src/Acorn.tsx). The chest is filled
  // (yours on this console), grey (not yours), or half: its lower right filled, its upper left grey (yours on another
  // console or PC; the owner's design, 2026-11-24).
  const CHEST_FRAME = 'M1 0h5v1H1zM0 1h1v5H0zM6 1h1v5H6zM1 2h2v1H1zM4 2h2v1H4zM1 5h5v1H1z';
  const CHEST_FILL = 'M1 1h5v1H1zM1 3h2v2H1zM4 3h2v2H4zM3 4h1v1H3z';
  const CHEST_LOCK = 'M3 2h1v2H3z';
  const chestParts = (owned) =>
    `<path d="${CHEST_FRAME}" fill="${owned ? '#6b3a10' : OFF}"/>${owned ? `<path d="${CHEST_FILL}" fill="#c27a3f"/>` : ''}<path d="${CHEST_LOCK}" fill="${owned ? '#e9b44c' : OFF}"/>`;
  // On its way to you: the chest whole, in a soft red (the owner's design, 2026-11-24).
  const comingParts = () => `<path d="${CHEST_FRAME}" fill="#b5483c"/><path d="${CHEST_FILL}" fill="#ee9b90"/><path d="${CHEST_LOCK}" fill="#fde3df"/>`;
  const chest = (kind, size = 14) => {
    const shown = kind === true ? 'own' : kind === false ? 'none' : kind;
    if (shown === 'coming') return `<svg viewBox="0 0 7 6" width="${Math.round((size * 7) / 6)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${comingParts()}</svg>`;
    const body = shown === 'elsewhere' ? `<defs><clipPath id="sc-half"><path d="M7 0V6H0z"/></clipPath></defs>${chestParts(false)}<g clip-path="url(#sc-half)">${chestParts(true)}</g>` : chestParts(shown === 'own');
    return `<svg viewBox="0 0 7 6" width="${Math.round((size * 7) / 6)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
  };
  const acorn = (size = 13) =>
    `<svg viewBox="0 0 5 6" width="${Math.round((size * 5) / 6)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 0h1v1H2zM0 1h5v2H0z" fill="#6b3a10"/><path d="M1 3h3v2H1zM2 5h1v1H2z" fill="#46a36b"/></svg>`;

  // A page open before the extension updated itself keeps this old script, which can't reach the new extension: every
  // question then answers that the page needs a refresh, instead of waiting for ever.
  const STALE = 'Deal check was updated: refresh this page to use it.';
  /** False once the extension has updated or reloaded under this page: its old script can't reach it any more. */
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  // Whatever still tries (a store's page changing, a click) is told quietly, not thrown as an error on every change.
  window.addEventListener('unhandledrejection', (e) => {
    if (/Extension context invalidated/i.test(String(e.reason?.message ?? e.reason))) {
      e.preventDefault();
      state?.observer?.disconnect();
    }
  });
  async function ask(message) {
    if (!alive()) return { error: STALE, stale: true };
    try {
      return (await chrome.runtime.sendMessage(message)) ?? { error: 'Deal check didn’t answer.' };
    } catch {
      return { error: STALE, stale: true };
    }
  }

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
        // Every card with a product id and a title: the results list, and the grids and rows between them ("featured"
        // rows, which aren't marked as search results). The innermost, so a card inside another counts once.
        const cards = [...document.querySelectorAll('[data-asin]:not([data-asin=""])')].filter((c) => c.querySelector('h2') && ![...c.querySelectorAll('[data-asin]:not([data-asin=""])')].some((d) => d.querySelector('h2')));
        for (const card of cards) {
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
    ebay: {
      name: 'eBay',
      test: () => /(^|\.)ebay\.(com|ca)$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('_nkw'));
        const out = [];
        for (const card of document.querySelectorAll('li.s-card, li.s-item')) {
          const t = card.querySelector('.s-card__title, .s-item__title');
          const title = text(t?.querySelector('span.primary, span[role="heading"]') ?? t).replace(/^New Listing\s*/i, '').replace(/Opens in a new window or tab$/i, '').trim();
          if (!t || !title || /^shop on ebay$/i.test(title)) continue;
          // eBay's own catalog line under the title ("Sony PlayStation 3 · Uncharted 2: Among Thieves"): the game as eBay
          // filed it, cleaner than the seller's words ("GOTY Greatest Hits (Used) PS3 - CIB -Untested-"). Not for a lot,
          // whose catalog line names only one of its games.
          const filed = [...card.querySelectorAll('.s-card__subtitle, .s-item__subtitle, .s-card__subtitle-row span')]
            .map((e) => /^(.+?)\s+·\s+(.+)$/.exec(text(e)))
            .find((m) => m && consoleIn(m[1]));
          if (filed && !LOT.test(title)) {
            // The seller's reprint label stays ("GOTY Greatest Hits"): eBay files every printing under one name.
            const label = [...title.matchAll(PRINTING)].map((m) => m[1]).join(' ');
            out.push({ at: t, title: `${filed[2].trim()}${label ? ` ${label}` : ''}`, price: priceIn(text(card.querySelector('.s-card__price, .s-item__price'))), seller: null, marketplace: false, hint: filed[1].trim() });
            continue;
          }
          out.push({ at: t, title, price: priceIn(text(card.querySelector('.s-card__price, .s-item__price'))), seller: null, marketplace: false, hint: consoleIn(title) ? null : pageHint });
        }
        // eBay's rows that scroll sideways ("Picked For You", "Similar sponsored items"): each item a link to its listing.
        const rowSeen = new Set();
        for (const a of document.querySelectorAll('.su-scrolling-item-cards a[href*="/itm/"], .carousel__list a[href*="/itm/"]')) {
          const t = a.querySelector('span.su-styled-text.primary, .s-item__title, [class*="title" i]');
          const id = /\/itm\/(?:[^/?]*\/)?(\d+)/.exec(a.getAttribute('href') ?? '')?.[1];
          const title = text(t).replace(/Opens in a new window or tab$/i, '').trim();
          if (!t || !title || !id || rowSeen.has(id)) continue;
          rowSeen.add(id);
          let card = a;
          for (let i = 0; i < 4 && card.parentElement && !/\$\s?\d/.test(text(card)); i++) card = card.parentElement;
          const price = [...card.querySelectorAll('span')].map(text).find((x) => /^\$\s?[\d,]+(\.\d\d)?$/.test(x));
          out.push({ at: t, title, price: priceIn(price), seller: null, marketplace: false, hint: consoleIn(title) ? null : pageHint });
        }
        const h1 = document.querySelector('h1.x-item-title__mainTitle, h1[data-testid="x-item-title"]');
        if (h1) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('.x-price-primary'))), seller: null, marketplace: false, hint: null });
        return out;
      },
    },
    mercari: {
      name: 'Mercari',
      test: () => /(^|\.)mercari\.com$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('keyword'));
        const out = [];
        for (const card of document.querySelectorAll('[data-testid="ProductThumbWrapper"], [data-testid="SearchResults"] a[href*="/item/"]')) {
          const t = card.querySelector('[data-testid="ItemName"]');
          const title = text(t) || card.querySelector('img')?.alt || '';
          if (!title) continue;
          out.push({ at: t ?? card, title, price: priceIn(text(card.querySelector('[data-testid="ProductThumbItemPrice"], [data-testid*="Price"]')) || text(card)), seller: null, marketplace: false, hint: consoleIn(title) ? null : pageHint });
        }
        const h1 = document.querySelector('[data-testid="ItemName"]:not([data-testid="ProductThumbWrapper"] *), h1');
        if (!out.length && h1 && /\/item\//.test(location.pathname)) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('[data-testid="ItemPrice"]'))), seller: null, marketplace: false, hint: null });
        return out;
      },
    },
    gamestop: {
      name: 'GameStop',
      test: () => /(^|\.)gamestop\.com$/.test(location.hostname),
      read() {
        const out = [];
        for (const card of document.querySelectorAll('div.product-tile')) {
          const t = card.querySelector('.render-tile-name, .pd-name, .product-tile-header');
          if (!t) continue;
          const href = card.querySelector('a[href*="/products/"]')?.getAttribute('href') ?? '';
          out.push({ at: t, title: text(t), price: priceIn(text(card.querySelector('.render-sale-price, .actual-price, .price'))), seller: null, marketplace: false, hint: consoleIn(href.replace(/[-/]+/g, ' ')) });
        }
        const h1 = document.querySelector('h1.product-name, h2.product-name, .pdp-product-name h1');
        if (h1) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('.primary-details-row .actual-price, .render-sale-price'))), seller: null, marketplace: false, hint: consoleIn(location.pathname.replace(/[-/]+/g, ' ')) });
        return out;
      },
    },
    target: {
      name: 'Target',
      test: () => /(^|\.)target\.com$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('searchTerm'));
        const out = [];
        for (const card of document.querySelectorAll('[data-test="ListingPageProductListing"], [data-test="@web/site-top-of-funnel/ProductCardWrapper"]')) {
          const img = card.querySelector('a[aria-label]');
          const title = (img?.getAttribute('aria-label') ?? '').replace(/\s*Sponsored\s*$/i, '').trim();
          const at = card.querySelector('a[data-test="content"]') ?? card.querySelector('a[data-test="product-title"]') ?? img;
          if (!title || !at) continue;
          out.push({ at, title, price: priceIn(text(card.querySelector('[data-test="current-price"]')) || text(at)), seller: null, marketplace: false, hint: consoleIn(title) ? null : pageHint });
        }
        const h1 = document.querySelector('h1[data-test="product-title"]');
        if (h1) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('[data-test="product-price"]'))), seller: null, marketplace: false, hint: null });
        return out;
      },
    },
    bestbuy: {
      name: 'Best Buy',
      test: () => /(^|\.)bestbuy\.(com|ca)$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('st'));
        const out = [];
        for (const card of document.querySelectorAll('div.list-item, li.sku-item')) {
          const t = card.querySelector('a.sku-title, .sku-title a, h4.sku-header a');
          if (!t) continue;
          out.push({ at: t, title: text(t), price: priceIn(text(card.querySelector('[data-testid="customer-price"], .priceView-customer-price')) || text(card.querySelector('.font-sans.text-default'))), seller: null, marketplace: false, hint: consoleIn(text(t)) ? null : pageHint });
        }
        const h1 = document.querySelector('h1.h4, .sku-title h1, h1[class*="title"]');
        if (!out.length && h1) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('[data-testid="customer-price"], .priceView-customer-price'))), seller: null, marketplace: false, hint: null });
        return out;
      },
    },
    gamefly: {
      name: 'GameFly',
      test: () => /(^|\.)gamefly\.com$/.test(location.hostname),
      read() {
        const out = [];
        for (const card of document.querySelectorAll('gf-thumbnail')) {
          const t = card.querySelector('.thumbnail-title');
          if (!t) continue;
          const alt = card.querySelector('img')?.alt ?? '';
          out.push({ at: t, title: text(t), price: priceIn(text(card.querySelector('ion-col.ion-text-right')) || text(card)), seller: null, marketplace: false, hint: consoleIn(alt.replace(/^.* on /, '')) });
        }
        if (!out.length && /\/game\//.test(location.pathname)) {
          const h1 = document.querySelector('h1');
          if (h1) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('[class*="price"]'))), seller: null, marketplace: false, hint: consoleIn(text(document.querySelector('[class*="platform"]')) || document.title) });
        }
        return out;
      },
    },
    nintendo: {
      name: 'Nintendo eShop',
      test: () => /(^|\.)nintendo\.com$/.test(location.hostname),
      read() {
        const out = [];
        const seen = new Set();
        for (const card of document.querySelectorAll('a[href*="/store/products/"]')) {
          const t = card.querySelector('h2, h3');
          const href = card.getAttribute('href') ?? '';
          if (!t || seen.has(href)) continue;
          seen.add(href);
          // The product's address ends with its console: "...-switch/", "...-switch-2/".
          const hint = /-switch-2\/?$/.test(href) ? 'Nintendo Switch 2' : /-switch\/?$/.test(href) ? 'Nintendo Switch' : 'Nintendo Switch';
          out.push({ at: t, title: text(t), price: priceIn(text(card)), seller: null, marketplace: false, hint });
        }
        const h1 = document.querySelector('h1');
        if (!out.length && h1 && /\/store\/products\//.test(location.pathname)) out.push({ at: h1, title: text(h1), price: priceIn(text(document.querySelector('[class*="price" i]'))), seller: null, marketplace: false, hint: /-switch-2\/?$/.test(location.pathname) ? 'Nintendo Switch 2' : 'Nintendo Switch' });
        return out;
      },
    },
    // Shops read by the general reader (repeated product cards; a product's own page by its structured data).
    shops: {
      name: 'this shop',
      test: () => GENERAL_SHOPS.some((s) => s.host.test(location.hostname)),
      read() {
        const shop = GENERAL_SHOPS.find((s) => s.host.test(location.hostname));
        this.name = shop.name;
        return generalRead(shop);
      },
    },
    vgp: {
      name: 'Video Games Plus',
      test: () => /(^|\.)videogamesplus\.ca$/.test(location.hostname),
      read() {
        const pageHint = consoleIn(query('q'));
        const out = [];
        for (const card of document.querySelectorAll('.productitem')) {
          const t = card.querySelector('.productitem--title');
          if (!t) continue;
          const stock = text(card.querySelector('.productitem--badge, [class*="inventory"], [class*="stock"]'));
          out.push({ at: t, title: text(t), price: priceIn(text(card.querySelector('.price__current'))), currency: 'CAD', seller: null, marketplace: false, hint: consoleIn(text(t)) ? null : pageHint, soldOut: /sold out/i.test(stock + text(card)) });
        }
        const h1 = document.querySelector('h1.product-title');
        if (h1 && !h1.closest('.productitem')) {
          const price = priceIn(text(document.querySelector('.product-pricing .price__current, .product-main .price__current, .price__current')));
          out.push({ at: h1, title: text(h1), price, currency: 'CAD', seller: null, marketplace: false, hint: null });
        }
        return out;
      },
    },
  };

  // The shops the general reader covers (2026-11-24: where the owner has bought games). `currency` when a shop prices in
  // another one; `pageHint` the address's query word that names a console.
  const GENERAL_SHOPS = [
    { name: 'Limited Run Games', host: /(^|\.)limitedrungames\.com$/ },
    { name: 'Super Rare Games', host: /(^|\.)superraregames\.com$/ },
    { name: 'Fangamer', host: /(^|\.)fangamer\.com$/ },
    { name: 'Woot', host: /(^|\.)woot\.com$/ },
    { name: 'Play-Asia', host: /(^|\.)play-asia\.com$/ },
    { name: 'eStarland', host: /(^|\.)estarland\.com$/ },
    { name: 'DKOldies', host: /(^|\.)dkoldies\.com$/ },
    { name: 'PNP Games', host: /(^|\.)pnpgames(online)?\.com$/ },
    { name: 'Square Enix Store', host: /(^|\.)square-enix-games\.com$/ },
    { name: 'Deku Deals', host: /(^|\.)dekudeals\.com$/, defaultHint: 'Nintendo Switch' },
    { name: 'PlayStation Store', host: /^store\.playstation\.com$/, defaultHint: 'PlayStation 5' },
    { name: 'Xbox Store', host: /(^|\.)xbox\.com$/, defaultHint: 'Xbox Series X' },
    { name: 'Microsoft Store', host: /^(www\.)?microsoft\.com$/, defaultHint: 'Xbox Series X' },
    { name: 'Nintendo eShop', host: /(^|\.)nintendo\.com$/, defaultHint: 'Nintendo Switch' },
    { name: 'Kinguin', host: /(^|\.)kinguin\.net$/ },
    { name: 'Outpost Gaming', host: /(^|\.)outpostgaming\.(com|net|shop)$/ },
  ];

  // Words that are never a game's title on a card: prices, buttons, ratings, delivery, badges.
  const NOT_A_TITLE = /^(add to (cart|bag|wishlist)|buy( now)?|sold out|out of stock|in stock|pre-?order|sponsored|sale|new|used|quick (view|shop)|choose options|select options|view (details|full details)|notify me|compare|free shipping.*|.*\bout of 5\b.*|\(?\d[\d,.]*\)?( reviews?| ratings?)?|save .*|\d+% off|released .*|ships .*|arrives .*|.*delivery.*|limited|exclusive|best ?seller|featured)$/i;
  const looksLikeTitle = (s) => s.length >= 3 && s.length <= 200 && !NOT_A_TITLE.test(s) && !/^(\$|£|€|¥|C\$|CA\$|USD)\s?\d/.test(s) && !/^<|<\/?[a-z]+[\s>]/i.test(s) && /[a-z]/i.test(s);

  /** A card's title: an element named for it (title, name, heading), else its product link's words, else its longest words. */
  function cardTitle(card) {
    const named = [...card.querySelectorAll('[class*="title" i], [class*="name" i], [class*="heading" i], [itemprop="name"], h2, h3, h4')].filter((e) => looksLikeTitle(text(e)) && text(e).length < 160);
    if (named.length) return named.sort((a, b) => text(b).length - text(a).length)[0];
    const links = [...card.querySelectorAll('a[href]')].filter((a) => looksLikeTitle(text(a)));
    if (links.length) return links.sort((a, b) => text(b).length - text(a).length)[0];
    const leaves = [...card.querySelectorAll('*')].filter((e) => e.children.length === 0 && looksLikeTitle(text(e)));
    return leaves.sort((a, b) => text(b).length - text(a).length)[0] ?? null;
  }

  /** The page's currency, when a shop says it (Shopify does); dollars otherwise. */
  const pageCurrency = () => window.Shopify?.currency?.active ?? (/\bC\$|CA\$/.test(document.body.innerText.slice(0, 20000)) ? 'CAD' : null);

  /**
   * The general reader: a page's repeated product cards (an element with a link, a picture and a price; the kind found
   * most often, at least three of it), or a product's own page (its structured data, or its heading and price).
   */
  function generalRead(shop) {
    const pageHint = consoleIn(document.title) ?? consoleIn(decodeURIComponent(location.search.replace(/[+&=?]/g, ' ')));
    // Prices, also those split into pieces ("US$<span>51</span>.99"): the smallest element whose words are a price.
    const PRICE = /^[^\d$£€¥]{0,12}(US\$|CA?\$|\$|£|€|¥)\s?\d[\d,.]*\s*\S{0,4}$/;
    const priced = [...document.querySelectorAll('body *')].filter((e) => {
      const t = text(e);
      if (t.length > 24 || !PRICE.test(t) || e.closest('.squirrelcade-deal')) return false;
      return ![...e.children].some((c) => PRICE.test(text(c)));
    });
    const groups = new Map();
    for (const p of priced) {
      let c = p;
      for (let i = 0; i < 10 && c.parentElement; i++) {
        c = c.parentElement;
        if ((c.matches('a[href]') || c.querySelector('a[href]')) && c.querySelector('img') && text(c).length > 12) break;
      }
      if (!(c.matches('a[href]') || c.querySelector('a[href]')) || !c.querySelector('img')) continue;
      const sig = `${c.tagName}.${[...c.classList].slice(0, 2).join('.')}`;
      const list = groups.get(sig) ?? [];
      if (!list.includes(c)) list.push(c);
      groups.set(sig, list);
    }
    // Shown cards only: a page that lists each game twice (eStarland's phone and desktop rows) keeps the visible ones.
    const shown = (c) => c.getClientRects().length > 0 && getComputedStyle(c).visibility !== 'hidden';
    const cards = [...groups.values()].map((list) => list.filter(shown)).sort((a, b) => b.length - a.length)[0] ?? [];
    const out = [];
    const currency = shop.currency ?? pageCurrency();
    if (cards.length >= 3) {
      for (const card of cards) {
        const t = cardTitle(card);
        if (!t) continue;
        let title = text(t);
        // A title cut off with an ellipsis ("Chained Echoes Complete Edition (Swi..."): the whole one from the picture's
        // description or a tooltip that starts the same way.
        if (/(\.\.\.|…)$/.test(title)) {
          const start = title.replace(/(\.\.\.|…)$/, '').trim();
          const whole = [...card.querySelectorAll('img[alt], [title], [aria-label]')].map((e) => e.getAttribute('alt') ?? e.getAttribute('title') ?? e.getAttribute('aria-label') ?? '').find((x) => x.length > start.length && x.startsWith(start));
          if (whole) title = whole;
        }
        const href = (card.matches('a[href]') ? card : card.querySelector('a[href]'))?.getAttribute('href') ?? '';
        const hint = consoleIn(title) ? null : consoleIn(card.querySelector('img')?.alt) ?? consoleIn(text(card)) ?? consoleIn(href.replace(/[-_/]+/g, ' ')) ?? pageHint ?? shop.defaultHint ?? null;
        out.push({ at: t, title, price: priceIn(text(priced.find((p) => card.contains(p)))), currency, seller: null, marketplace: false, hint });
      }
      if (out.length) return out;
    }
    // Cards without a price on them (Fangamer's grid): the page's product links, each once, with the link's words (or
    // its picture's) for the title. Not on a product's own page, whose links are other products.
    const PRODUCT_LINK = /\/(products?|item|itm|game|games|offers|p)\/[^/?#]{3,}/i;
    const onProductPage = PRODUCT_LINK.test(location.pathname) && document.querySelector('h1');
    if (!onProductPage) {
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        let u;
        try {
          u = new URL(a.href);
        } catch {
          continue;
        }
        if (u.host !== location.host || !PRODUCT_LINK.test(u.pathname) || seen.has(u.pathname) || a.closest('nav, header, footer, .squirrelcade-deal')) continue;
        const named = [...a.querySelectorAll('*')].find((e) => e.children.length === 0 && looksLikeTitle(text(e))) ?? (looksLikeTitle(text(a)) ? a : null);
        const title = named ? text(named) : (a.querySelector('img')?.alt ?? '').trim();
        if (!looksLikeTitle(title)) continue;
        seen.add(u.pathname);
        out.push({ at: named ?? a, title, price: null, currency, seller: null, marketplace: false, hint: consoleIn(title) ? null : consoleIn(a.closest('li, article, [class*="card" i], [class*="product" i]')?.textContent) ?? pageHint ?? shop.defaultHint ?? null });
      }
      if (out.length >= 3) return out;
      out.length = 0;
    }
    // A product's own page: schema.org Product data first, then the page's heading.
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const items = (Array.isArray(data) ? data : [data]).flatMap((d) => (d['@graph'] ? d['@graph'] : [d]));
      const product = items.find((d) => /Product|VideoGame/.test([].concat(d['@type'] ?? []).join(' ')));
      if (product?.name) {
        const offer = [].concat(product.offers ?? [])[0] ?? {};
        const h1 = document.querySelector('h1');
        const price = offer.price ?? offer.lowPrice;
        out.push({ at: h1, title: String(product.name), price: price ? Math.round(Number(price) * 100) : null, currency: offer.priceCurrency && offer.priceCurrency !== 'USD' ? offer.priceCurrency : currency, seller: null, marketplace: false, hint: consoleIn(String(product.name)) ? null : consoleIn([].concat(product.gamePlatform ?? []).join(' ')) ?? pageHint });
        return out;
      }
    }
    const h1 = document.querySelector('h1');
    const metaPrice = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"], [itemprop="price"]');
    if (h1 && looksLikeTitle(text(h1)) && metaPrice) {
      const amount = metaPrice.getAttribute('content') ?? text(metaPrice);
      out.push({ at: h1, title: text(h1), price: priceIn(`$${amount}`), currency, seller: null, marketplace: false, hint: consoleIn(text(h1)) ? null : pageHint });
    }
    return out;
  }

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
    .b { display: inline-flex; align-items: center; gap: 5px; row-gap: 4px; flex-wrap: wrap; margin: 4px 0 2px; padding: 4px 7px 4px 8px; border-radius: 12px;
         font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a22; background: #fff; border: 1px solid #d8ddd9;
         box-shadow: 0 1px 2px rgba(0,0,0,.06); cursor: default; max-width: 100%; box-sizing: border-box; }
    /* The answer in the badge's color (the owner's wish, 2026-11-24): green, yours (here or on another console) and sure;
       red, sure you don't have it; grey, medium or low (to look at). On its way stays plain. */
    .b.yes { background: #e2f3e7; border-color: #93cba5; }
    .b.no { background: #fbe8e6; border-color: #e3aaa4; }
    .b.check { background: #eceeed; border-color: #c9cecb; }
    .muted { color: #5c6a60; font-weight: 500; }
    .flag { padding: 0 6px; border-radius: 4px; background: #fff3cd; color: #7a5300; font-weight: 600; }
    .flag.bad { background: #ffe3e3; color: #9b1c1c; }
    button { all: unset; cursor: pointer; padding: 1px 7px; border-radius: 999px; background: #eef1ef; color: #1f2a22; font-weight: 600;
             display: inline-flex; align-items: center; gap: 3px; }
    button:hover { background: #dfe5e1; }
    button:focus-visible { outline: 2px solid #2f7d4f; outline-offset: 1px; }
    /* A game on many consoles: its marks wrap inside the card rather than run past it (The Wandering Village, six). */
    .stash { gap: 4px; row-gap: 3px; flex-wrap: wrap; max-width: 100%; padding: 1px 4px; border-radius: 6px; background: transparent; }
    .stash:hover { background: #eef1ef; }
    .stash svg { display: block; }
    .stash svg.unlit { filter: grayscale(1); opacity: .45; }
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
    .thinks { margin: 2px 0 8px; padding: 7px 9px; border-radius: 8px; background: #f4f6f5; font-size: 13px; }
    .opt { display: flex; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 6px 9px; margin: 2px 0; border-radius: 8px; background: #f4f6f5; }
    .opt.on { background: #dff2e6; box-shadow: inset 0 0 0 1px #8fcca6; }
    .opt[disabled] { opacity: .5; cursor: wait; }
  `;

  const state = { rows: [], hosts: [], bar: null, pop: null, drawer: null, store: 'this page', preferences: [], seen: new WeakSet(), leftOut: 0, observer: null };

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
    if (r.chest === 'coming') return `Stash (on the way: ${r.onTheWay.store}${r.onTheWay.orderDate ? `, ordered ${r.onTheWay.orderDate}` : ''})`;
    if (r.chest === 'elsewhere') return `Stash (owned on ${r.ownedOn.join(', ')}, not this console)`;
    return 'Stash (unowned)';
  }

  const PUBLISHER = /^(?:koei tecmo|tecmo koei|koei|square enix|bandai namco|namco bandai|capcom|konami|ubisoft|electronic arts|activision|atlus|sega|2k games|2k|take-two|warner bros\.?(?: games| interactive)?|wb games|thq nordic|thq|nis america|nippon ichi(?: software)?|xseed(?: games)?|aksys(?: games)?|bethesda(?: softworks)?|devolver(?: digital)?|marvelous(?: usa)?|idea factory|spike chunsoft|level-5|deep silver|focus (?:home|entertainment)|nacon|microids|limited run games|numskull(?: games)?|pqube|rising star(?: games)?|natsume|d3 ?publisher|505 games|gearbox(?: publishing)?|rockstar(?: games)?|nintendo|sony|microsoft|square|tecmo|namco)\b[\s:\-–|]+/i;

  // A listing of several games ("15 ps3 games see discription", "Nintendo switch games lot", "bundle", "bulk"): its title
  // names no one game, so the answer can't be sure (the owner, 2026-11-24: "how could it know if I had it or not?").
  // ("2 Games in 1" is one compilation, not a lot.)
  const LOT = /\b(lots?|bundle|bulk|job ?lot|collection of \d+|mixed|pick (?:your|a|any) games?|choose (?:your|a|any) games?|you (?:pick|choose)|multi-?listing|\$\d+(?:\.\d\d)? each)\b|^\s*(?:ps[1-5]|xbox(?: 360| one)?|switch|wii u?|nintendo \w+|sega \w+|gamecube|n64)\s+(?:video\s+)?games\b|^\s*\d+\s*x?\s*(?:[a-z0-9]+\s+){0,3}(?:video\s*)?(?:games|titles|discs)\b(?!\s+in\s+1)|\b\d+\s+(?:video\s+)?(?:games|titles)\b(?!\s+in\s+1)/i;
  /**
   * The answer's sureness, honest about what the listing gives: a lot is Low (which games, it can't say); a title nothing
   * of yours or of your wishlist knows is at most Medium (it may not be a game's name at all).
   */
  function honestSureness(row) {
    const r = row.result;
    if (r.corrected?.kind === 'lot') row.lot = true;
    if (r.corrected) return r;
    if (LOT.test(row.title) && r.answer !== 'own') {
      row.lot = true;
      return { ...r, sure: 'unsure', chest: r.chest === 'coming' ? 'coming' : 'none', preference: null, why: 'Not sure: this listing is a lot of several games, and its title doesn’t say which, so Squirrelcade can’t tell whether you have them.' };
    }
    if (r.answer === 'need' && !r.match && !r.wishlist && r.sure === 'sure') {
      return { ...r, sure: 'likely', why: 'Pretty sure: nothing of yours comes close, but Squirrelcade doesn’t know this title either (not in its catalogs or your wishlist), so it may not be a game’s name.' };
    }
    return r;
  }

  // When each console came out, for keeping a badge's marks to the listing's own era: a remake shares its name with the
  // original ("Star Fox" on Switch 2 and on the Super Nintendo), and Squirrelcade's marks go by the name.
  const CONSOLE_YEAR = {
    'nintendo-entertainment-system': 1985, 'super-nintendo': 1991, 'nintendo-64': 1996, 'nintendo-gamecube': 2001, wii: 2006, 'wii-u': 2012,
    'nintendo-switch': 2017, 'nintendo-switch-2': 2025, 'game-boy': 1989, 'game-boy-color': 1998, 'game-boy-advance': 2001, 'nintendo-ds': 2004,
    'nintendo-3ds': 2011, 'virtual-boy': 1995, playstation: 1995, 'playstation-2': 2000, 'playstation-3': 2006, 'playstation-4': 2013,
    'playstation-5': 2020, psp: 2005, 'playstation-portable': 2005, 'playstation-vita': 2012, xbox: 2001, 'xbox-360': 2005, 'xbox-one': 2013,
    'xbox-series-x': 2020, 'sega-master-system': 1986, 'sega-genesis': 1989, 'sega-cd': 1992, 'sega-32x': 1994, 'sega-saturn': 1995,
    'sega-dreamcast': 1999, 'sega-game-gear': 1991, 'atari-2600': 1977, 'turbografx-16': 1989, 'neo-geo': 1990,
  };
  const yearOf = (key) => CONSOLE_YEAR[key] ?? CONSOLE_YEAR[key.replace(/-(jp|japan|pal|eu|kr|cn)$/, '')] ?? null;
  /** The marks of consoles from the listing's era (within 9 years of its console), PC kept; all of them without a console. */
  function marksOfItsTime(r) {
    const marks = r.marks ?? [];
    const anchor = r.platformKey ? yearOf(r.platformKey) : null;
    if (anchor === null) return marks;
    return marks.filter((m) => m.key === 'pc' || yearOf(m.key) === null || Math.abs(yearOf(m.key) - anchor) <= 9);
  }

  // One listing's badge: the chest and console marks (they open the game's drawer), the acorns (your preference), the
  // copy's flags, PriceCharting, and how sure the answer is (H, M, L).
  function badge(row) {
    const r = row.result;
    const host = document.createElement('span');
    host.className = 'squirrelcade-deal';
    // Above the link a store spreads over its whole tile (Walmart's, at z-index 1), so the badge's buttons get the clicks;
    // low enough to stay under the store's own header.
    Object.assign(host.style, { display: 'block', position: 'relative', zIndex: '3', maxWidth: '100%' });
    const root = host.attachShadow({ mode: 'open' });
    const level = LEVEL[r.sure];
    // A console mark lights only as far as the chest agrees (the owner, 2026-11-24): a grey chest greys every mark, a half
    // chest the listing's own console; the marks of a near miss ("maybe") never say "yours".
    const lit = (m) => m.owned && (r.chest === 'own' || (r.chest === 'elsewhere' && m.key !== r.platformKey));
    const marks = marksOfItsTime(r).map((m) => (m.owned && !lit(m) ? m.svg.replace('<svg ', '<svg class="unlit" ') : m.svg)).join('');
    const acornsButton = r.preference
      ? `<button type="button" class="acorns" title="Your acorns for it: change your preference">${acorn()} ${r.wishlist ? `${r.wishlist.acorns} <span class="muted">${esc(r.wishlist.priority)}</span>` : '<span class="muted">Acorns</span>'}${r.preference.value ? ` <span class="muted">· ${esc(r.preference.value)}</span>` : ''}</button>`
      : '';
    const flags = [...r.flags.map((f) => `<span class="flag${f === 'game-key-card' ? ' bad' : ''}">${esc(FLAGS[f] ?? f)}</span>`), row.marketplace ? `<span class="flag" title="${esc(row.seller)}">Marketplace seller</span>` : '', row.region ? `<span class="flag" title="${esc(row.region)}">Import</span>` : '', row.lot ? '<span class="flag bad" title="Several games in one listing">Lot</span>' : ''].join('');
    const label = `${chestLabel(r)}: open it in Squirrelcade`;
    root.innerHTML =
      `<style>${css}</style><span class="b ${tone(r, level)}">` +
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

  /** The badge's color: yes (yours, here or elsewhere, sure), no (sure it isn't), check (medium or low), or plain (on its way). */
  const tone = (r, level) => (level !== 'H' ? 'check' : r.chest === 'own' || r.chest === 'elsewhere' ? 'yes' : r.chest === 'coming' ? '' : 'no');

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
        : r.chest === 'coming'
          ? `On its way to you: ${esc(r.onTheWay.store)}${r.onTheWay.orderDate ? `, ordered ${esc(r.onTheWay.orderDate)}` : ''}${r.onTheWay.paidCents !== null ? ` (${money(r.onTheWay.paidCents)})` : ''}`
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
    // First, plainly, the game it takes the listing for (the owner's wish, 2026-11-24): the game of his it matched, else
    // the title it read; a lot names none.
    const thinks = row.lot
      ? 'several games (a lot), none named'
      : `<b>${esc(r.match && r.match.confidence >= 0.85 ? r.match.title : r.title)}</b>${r.platform ? ` <span class="muted">(${esc(r.platform)})</span>` : ''}`;
    popup(button, gameHeading(r)).draw(`<div class="thinks">Squirrelcade thinks this is ${thinks}</div><table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table><div class="o">The chest opens it in Squirrelcade.</div><button type="button" class="opt wrong"><span>Wrong game?</span><span class="muted">tell Squirrelcade</span></button>`)
      .querySelector('.wrong')
      .addEventListener('click', () => showWrong(row, button));
  }

  /** The listing asked again, and its badge drawn afresh: after a preference or a correction is kept. */
  async function recheck(row) {
    const again = await ask({ type: 'check', items: [{ title: row.title, platform: row.hint }] });
    if (!again?.results?.[0] || !row.host) return;
    row.lot = false;
    row.result = again.results[0];
    row.result = honestSureness(row);
    if (row.result.corrected?.kind === 'not-game') {
      row.host.remove();
      state.hosts.splice(state.hosts.indexOf(row.host), 1);
      state.rows.splice(state.rows.indexOf(row), 1);
      state.leftOut++;
      report(summary());
      return;
    }
    const fresh = badge(row);
    row.host.replaceWith(fresh);
    state.hosts[state.hosts.indexOf(row.host)] = fresh;
    row.host = fresh;
  }

  /**
   * Wrong game? (the owner's wish, 2026-11-24): pick the game the listing really is from Squirrelcade's own (search
   * prefilled with what it read, on the listing's console), or say it's no game or a lot. Squirrelcade keeps it for
   * these words, every later check reads them so, and the monthly reader check (T-592) looks over what was corrected.
   */
  function showWrong(row, button) {
    const r = row.result;
    const { draw } = popup(button, gameHeading(r));
    let everywhere = !r.platformKey;
    const render = (query, found, message = '') => {
      const root = draw(
        `<div class="muted" style="margin-bottom:6px">Which game is it? Squirrelcade will read “${esc(r.listing)}” as your pick from now on.</div>` +
          `<form class="find"><input type="search" value="${esc(query)}" aria-label="Search your games" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #c9cfcc;border-radius:7px;font:inherit"></form>` +
          (r.platformKey ? `<label class="muted" style="display:block;margin:6px 0"><input type="checkbox" class="all"${everywhere ? ' checked' : ''}> Every console, not only ${esc(r.platform)}</label>` : '') +
          (found === null ? '<div class="muted">Looking…</div>' : found.length === 0 ? '<div class="muted">Nothing by that name. Try fewer words.</div>' : found.map((g, i) => `<button type="button" class="opt pick" data-i="${i}"><span>${esc(g.title)}</span><span class="muted">${esc(g.platform)}</span></button>`).join('')) +
          '<div style="display:flex;gap:6px;margin-top:6px"><button type="button" class="opt kind" data-k="not-game"><span>Not a game</span></button><button type="button" class="opt kind" data-k="lot"><span>A lot</span></button></div>' +
          (message ? `<div class="o">${esc(message)}</div>` : ''),
      );
      const input = root.querySelector('input[type=search]');
      root.querySelector('.find').addEventListener('submit', (e) => {
        e.preventDefault();
        search(input.value);
      });
      root.querySelector('.all')?.addEventListener('change', (e) => {
        everywhere = e.currentTarget.checked;
        search(input.value);
      });
      const save = async (body) => {
        root.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
        const res = await ask({
          type: 'api',
          url: '/api/v1/deal-check/corrections',
          method: 'POST',
          contentType: 'application/json',
          body: JSON.stringify({ listing: r.listing, wasTitle: r.title, wasPlatformKey: r.platformKey, ...body }),
        });
        if (!res || res.error || !(res.status < 300)) {
          render(input.value, found, res?.stale ? STALE : res?.status === 404 ? 'Squirrelcade needs its next update for this.' : 'Squirrelcade didn’t take it. Try again in a moment.');
          return;
        }
        state.pop?.remove();
        await recheck(row);
      };
      root.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
        const g = found[Number(b.getAttribute('data-i'))];
        save({ kind: 'game', title: g.title, platformKey: g.platformKey });
      }));
      root.querySelectorAll('.kind').forEach((b) => b.addEventListener('click', () => save({ kind: b.getAttribute('data-k') })));
      return input;
    };
    const search = async (query) => {
      const q = query.trim();
      render(q, null);
      if (!q) return render(q, []);
      const ask1 = async (platform) => {
        const res = await ask({ type: 'api', url: `/api/v1/lookup?q=${encodeURIComponent(q)}&games=8&brief=1${platform ? `&platform=${encodeURIComponent(platform)}` : ''}` });
        if (!res || res.error || !(res.status < 300)) return [];
        const seen = new Set();
        return (JSON.parse(res.body).results ?? []).filter((g) => {
          const k = `${g.platformKey}|${g.title}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 12);
      };
      let found = await ask1(everywhere ? null : r.platformKey);
      // Nothing on the listing's console: the same search everywhere.
      if (found.length === 0 && !everywhere) {
        everywhere = true;
        found = await ask1(null);
      }
      const input = render(q, found);
      input.focus();
    };
    search(r.match?.title?.replace(/\s*\[[^\]]*\]\s*$/, '') ?? r.title);
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
          const res = await ask({
            type: 'api',
            url: '/api/v1/wishlist/preferences',
            method: 'PUT',
            contentType: 'application/json',
            body: JSON.stringify({ platformKey: r.preference.platformKey, title: r.preference.title, preference: name === 'No Adjustment' ? null : name }),
          });
          if (!res || res.error || !(res.status < 300)) {
            render(res?.stale ? STALE : 'Squirrelcade didn’t take it. Try again in a moment.');
            return;
          }
          // The listing asked again: its acorns, priority and preference as Squirrelcade has them now.
          state.pop?.remove();
          await recheck(row);
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
    if (!alive()) return report(STALE);
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

  /** A listing's price in US cents for the deal meter, from another currency at today's rate (Frankfurter, the ECB's). */
  async function inDollars(row) {
    if (row.price === null || row.price === undefined) return null;
    if (!row.currency || row.currency === 'USD') return row.price;
    const answer = await ask({ type: 'rate', from: row.currency, to: 'USD' });
    return answer?.rate ? Math.round(row.price * answer.rate) : null;
  }
  const listingPrice = (row) => (row.currency && row.currency !== 'USD' ? `${money(row.price)} ${row.currency}` : money(row.price));

  async function showPrices(row, button) {
    const r = row.result;
    const { host, draw } = popup(button, gameHeading(r));
    draw('<div class="muted">Reading PriceCharting…</div>');
    const answer = await ask({ type: 'prices', url: r.priceChartingUrl, title: r.title, platform: r.platform });
    if (!host.isConnected) return;
    const best = answer?.products?.[0];
    if (!best) {
      draw(`<div class="muted">${esc(answer?.error ?? 'PriceCharting has no match.')}</div><div style="margin-top:8px"><a href="${esc(r.priceChartingUrl)}" target="_blank" rel="noopener">Search PriceCharting ›</a></div>`);
      return;
    }
    row.prices = best;
    const dollars = await inDollars(row);
    if (!host.isConnected) return;
    const others = answer.products.slice(1).map((p) => `<div class="o"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a> · ${esc(p.console)}: ${money(p.loose)} / ${money(p.cib)} / ${money(p.new)}</div>`).join('');
    draw(
      `<div class="muted">${esc(best.title)} · ${esc(best.console)}</div>` +
        `<table><tr><th>Loose</th><td class="n">${money(best.loose)}</td></tr><tr><th>Complete (CIB)</th><td class="n">${money(best.cib)}</td></tr><tr><th>New</th><td class="n">${money(best.new)}</td></tr>` +
        (row.price !== null ? `<tr><th>This listing</th><td class="n">${listingPrice(row)}${dollars !== null && dollars !== row.price ? ` <span class="muted">(${money(dollars)})</span>` : ''}</td></tr>` : '') +
        (r.valueCents !== null ? `<tr><th>Your copy</th><td class="n">${money(r.valueCents)}</td></tr>` : '') +
        `</table>${dealMeter(dollars, best.new)}<a href="${esc(best.url)}" target="_blank" rel="noopener">Open on PriceCharting ›</a>${others ? `<div style="margin-top:8px" class="muted">Other matches</div>${others}` : ''}`,
    );
  }

  // What the toolbar button's window shows (it took the corner bar's place, the owner's wish, 2026-11-24): the last
  // word on the page, and the number of games on the button itself.
  function report(message, opts = {}) {
    state.message = message;
    state.needsOptions = Boolean(opts.options);
    const games = new Set(state.rows.map((r) => `${r.result.title}|${r.result.platformKey}`)).size;
    if (alive()) chrome.runtime.sendMessage({ type: 'badge', text: games ? String(games) : '' }).catch(() => {});
  }

  /** The page's results as a short table to paste into a chat with Claude (the window writes it to the clipboard). */
  function copyText() {
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
        return `| ${cell(row.title)} | ${cell(r.title)} | ${cell(r.platform ?? '?')} | ${row.price !== null ? listingPrice(row) : ''} | ${cell(row.seller ?? '')} | ${cell(mine)} | ${SURE[r.sure].word} | ${r.wishlist ? `${r.wishlist.acorns} (${r.wishlist.priority})` : ''} | ${pc} | ${cell(flags)} |`;
      }),
    ];
    return lines.join('\n');
  }

  // What the page's games add up to, in a sentence.
  function summary() {
    const games = new Map(state.rows.map((r) => [`${r.result.title}|${r.result.platformKey}`, r.result]));
    const mine = [...games.values()].filter((r) => r.answer === 'own').length;
    const wanted = [...games.values()].filter((r) => r.answer !== 'own' && r.wishlist).length;
    const unsure = [...games.values()].filter((r) => r.sure === 'unsure').length;
    const list = state.hosts.length === 0 && state.rows.length > 0 ? ' (selected lines: the table is in Copy for Claude)' : '';
    const others = state.leftOut ? ` · ${state.leftOut} not games left out` : '';
    return `${games.size} games: ${mine} yours, ${wanted} on your wishlist${unsure ? `, ${unsure} to check` : ''}${others}${list}`;
  }

  /**
   * Checks the page. `more`: only the listings not checked yet (more results loaded as you scroll), added to what's
   * there. `auto`: run by itself on a store's page, so a problem (Squirrelcade not answering away from home) stays quiet.
   */
  async function scan({ more = false, auto = false } = {}) {
    if (!more) {
      clear();
      state.seen = new WeakSet();
      state.leftOut = 0;
    }
    const reader = Object.values(READERS).find((r) => r.test());
    let listings = reader ? reader.read() : [];
    state.store = reader?.name ?? location.hostname;
    if (listings.length === 0 && !auto) listings = selectedLines();
    listings = listings.filter((l) => l.title && l.title.length >= 2 && !(l.at && state.seen.has(l.at))).map(withoutRegion);
    for (const l of listings) if (l.at) state.seen.add(l.at);
    if (listings.length === 0) {
      if (!more && !auto) report(reader ? 'No games found on this page.' : 'Select the titles to check, then press Check this page.');
      return;
    }
    if (!more && !auto) report(`Checking ${listings.length} listings…`);
    // Each title once, with its console.
    const keyOf = (l) => `${l.title}|${l.hint ?? ''}`;
    const unique = [...new Map(listings.map((l) => [keyOf(l), { title: l.title, platform: l.hint }])).entries()];
    const seconds = unique.map(([, i]) => {
      const m = PUBLISHER.exec(i.title);
      return m && i.title.length > m[0].length + 2 ? { title: i.title.slice(m[0].length), platform: i.platform } : null;
    });
    const extra = seconds.filter(Boolean);
    const answer = await ask({ type: 'check', items: [...unique.map(([, i]) => i), ...extra] });
    if (answer && !answer.error && extra.length) {
      let at = unique.length;
      // The better answer wins: yours here, then yours elsewhere, then a close one ("Capcom Resident Evil 6" only came
      // close to your Resident Evil 6, which the second reading finds), then on the wishlist, then nothing.
      const rank = (r) => (!r ? -1 : r.corrected ? 99 : ({ own: 4, elsewhere: 3, maybe: 1, need: 0 }[r.answer] ?? 0) + (r.wishlist ? 0.5 : 0) + (r.sure === 'sure' ? 0.2 : r.sure === 'likely' ? 0.1 : 0));
      seconds.forEach((sec, i) => {
        if (!sec) return;
        const second = answer.results[at++];
        if (rank(second) > rank(answer.results[i])) answer.results[i] = { ...second, listing: answer.results[i]?.listing ?? second.listing };
      });
      answer.results.length = unique.length;
    }
    if (!answer || answer.error) {
      // Run by itself, the page stays as it was; asked for, the bar says why.
      if (auto) {
        // Away from home, say: it stops for this page rather than asking again at every change.
        unwatch();
      } else {
        report(answer?.error ?? 'Squirrelcade didn’t answer.', { options: answer?.options });
      }
      return;
    }
    state.preferences = answer.preferences ?? state.preferences;
    const byKey = new Map(unique.map(([k], i) => [k, answer.results[i]]));
    for (const l of listings) {
      const row = { ...l, result: byKey.get(keyOf(l)) };
      if (!row.result) continue;
      row.result = honestSureness(row);
      if (row.result.corrected?.kind === 'not-game' || (!row.result.corrected && notAGame(row))) {
        state.leftOut++;
        continue;
      }
      state.rows.push(row);
      if (row.at?.isConnected) {
        const host = badge(row);
        row.host = host;
        row.at.after(host);
        state.hosts.push(host);
      }
    }
    if (state.rows.length > 0 || !auto) report(summary());
  }

  // Running by itself on the stores Deal check reads (the owner's choice, 2026-11-24): on by default, off for a store
  // with the bar's "Auto" button. New results as you scroll are checked a couple of seconds after they appear; a
  // store's page that changes its address without reloading (a new search) is checked afresh.
  const autoKey = () => (Object.values(READERS).some((r) => r.test()) ? `auto:${location.hostname.replace(/^www\./, '')}` : 'auto:');
  async function autoOn() {
    const key = autoKey();
    return key !== 'auto:' && alive() && (await chrome.storage.local.get(key))[key] !== false;
  }
  function watch() {
    if (state.observer) return;
    let timer = null;
    let page = location.href;
    state.observer = new MutationObserver((changes) => {
      // The badges' own changes don't count.
      if (changes.every((c) => [...c.addedNodes, ...c.removedNodes].every((n) => n.classList?.contains?.('squirrelcade-deal')))) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (location.href !== page) {
          page = location.href;
          scan({ auto: true });
        } else scan({ more: true, auto: true });
      }, 1500);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }
  function unwatch() {
    state.observer?.disconnect();
    state.observer = null;
  }
  async function toggleAuto() {
    const on = !(await autoOn());
    await chrome.storage.local.set({ [autoKey()]: on });
    if (on) watch();
    else unwatch();
    report(on ? `Runs by itself on ${state.store} again.` : `Won’t run by itself on ${state.store}: use Check again here.`);
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

  // `peek` lists what the page's reader finds, without asking Squirrelcade: for checking the readers (the monthly check).
  const peek = () => {
    const reader = Object.values(READERS).find((r) => r.test());
    const listings = (reader ? reader.read() : []).map(withoutRegion);
    return { store: reader?.name ?? null, count: listings.length, listings: listings.map((l) => ({ title: l.title, price: l.price, currency: l.currency ?? null, hint: l.hint, region: l.region ?? null, badgeSpot: Boolean(l.at) })) };
  };
  window.__squirrelcadeDeal = { scan, clear, peek };

  /** The page's state for the toolbar button's window. */
  function forWindow() {
    const games = new Map(state.rows.map((r) => [`${r.result.title}|${r.result.platformKey}`, r.result]));
    const list = [...games.values()];
    return {
      store: state.store,
      message: state.message ?? null,
      needsOptions: Boolean(state.needsOptions),
      games: games.size,
      mine: list.filter((r) => r.answer === 'own').length,
      coming: list.filter((r) => r.chest === 'coming').length,
      wanted: list.filter((r) => r.answer !== 'own' && r.wishlist).length,
      unsure: list.filter((r) => r.sure === 'unsure').length,
      leftOut: state.leftOut ?? 0,
      autoAvailable: autoKey() !== 'auto:',
      auto: Boolean(state.observer),
      checked: state.message !== undefined,
    };
  }
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m?.type === 'window') reply(forWindow());
    else if (m?.type === 'rescan') scan().then(() => reply(forWindow()));
    else if (m?.type === 'toggleAuto') toggleAuto().then(() => reply(forWindow()));
    else if (m?.type === 'copyText') reply({ text: copyText(), count: state.rows.length });
    else if (m?.type === 'clearBadges') {
      unwatch();
      clear();
      state.message = undefined;
      if (alive()) chrome.runtime.sendMessage({ type: 'badge', text: '' }).catch(() => {});
      reply(forWindow());
    } else return false;
    return true;
  });
  if (window.__squirrelcadeManual) {
    window.__squirrelcadeManual = false;
    scan();
  } else {
    autoOn().then(async (on) => {
      const { server, key } = await chrome.storage.local.get(['server', 'key']);
      if (!on || !server || !key) return;
      // Watching first, so the bar's first drawing already says Auto: on.
      watch();
      await scan({ auto: true });
    });
  }
})();
