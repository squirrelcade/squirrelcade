// Squirrelcade Deal check: the toolbar button, and the two things a store's page can't do itself (D245):
// ask your Squirrelcade (with the key from the extension's options) and read PriceCharting's prices for a game.
// Nothing runs until you press the button, and only on the tab you pressed it on.

const BATCH = 50;

// Updating itself (the owner's wish, 2026-11-24): loaded from a folder, the extension can't be updated by a store, so it
// reads its own manifest on disk now and then and reloads itself when the version there is newer than the one running.
// The next store page's bar says so.
const CHECK_MINUTES = 10;
async function checkForUpdate() {
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = (await res.json()).version;
    if (onDisk && onDisk !== chrome.runtime.getManifest().version) {
      await chrome.storage.local.set({ updated: onDisk });
      chrome.runtime.reload();
    }
  } catch {
    // A manifest being written just now: the next check reads it whole.
  }
}
chrome.runtime.onStartup.addListener(checkForUpdate);
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('update-check', { periodInMinutes: CHECK_MINUTES }));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'update-check') checkForUpdate();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const { server, key } = await chrome.storage.local.get(['server', 'key']);
  if (!server || !key) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    // Pressed: check now, whatever the store's Auto says.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__squirrelcadeManual = true; } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    // A page the browser keeps extensions out of (its own pages, the extension stores).
    console.warn('Squirrelcade Deal check cannot run here:', e);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'check') {
    check(message.items).then(reply, (e) => reply({ error: String(e?.message ?? e) }));
    return true;
  }
  if (message?.type === 'prices') {
    prices(message.url, message.title, message.platform).then(reply, (e) => reply({ error: String(e?.message ?? e) }));
    return true;
  }
  if (message?.type === 'api') {
    api(message).then(reply, (e) => reply({ status: 502, type: 'application/json', body: JSON.stringify({ error: 'error', message: String(e?.message ?? e) }) }));
    return true;
  }
  if (message?.type === 'picture') {
    picture(message.url).then((dataUrl) => reply({ dataUrl }), () => reply({ dataUrl: null }));
    return true;
  }
  if (message?.type === 'rate') {
    rate(message.from, message.to).then((r) => reply({ rate: r }), () => reply({ rate: null }));
    return true;
  }
  if (message?.type === 'options') {
    chrome.runtime.openOptionsPage();
  }
  return false;
});

/** Asks Squirrelcade about the listings, 50 at a time. */
async function check(items) {
  const { server, key } = await chrome.storage.local.get(['server', 'key']);
  if (!server || !key) return { error: 'Set your Squirrelcade address and key in the extension’s options.', options: true };
  const results = [];
  let preferences = [];
  for (let i = 0; i < items.length; i += BATCH) {
    let res;
    try {
      res = await fetch(new URL('api/v1/deal-check', server.endsWith('/') ? server : `${server}/`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ items: items.slice(i, i + BATCH) }),
      });
    } catch {
      return { error: `Squirrelcade didn’t answer at ${server}. It works on your home network only.` };
    }
    if (res.status === 401 || res.status === 403) return { error: 'Squirrelcade turned the key down. Check it in the extension’s options.', options: true };
    if (res.status === 404) return { error: 'This Squirrelcade has no Deal check yet: update it.' };
    if (!res.ok) return { error: `Squirrelcade answered ${res.status}.` };
    const answer = await res.json();
    results.push(...answer.results);
    preferences = answer.preferences ?? preferences;
  }
  return { results, preferences };
}

/**
 * One call to Squirrelcade's API with your key, for the game drawer over a store's page and the badge's acorns: only
 * paths under /api/v1/. The answer comes back as text with its status and type.
 */
async function api({ url, method = 'GET', contentType = null, body = null }) {
  const { server, key } = await chrome.storage.local.get(['server', 'key']);
  if (!server || !key) return { status: 401, type: 'application/json', body: JSON.stringify({ error: 'unauthorized', message: 'Set your Squirrelcade address and key in the extension’s options.' }) };
  if (typeof url !== 'string' || !url.startsWith('/api/v1/')) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'invalid', message: 'Not an API path.' }) };
  const res = await fetch(new URL(url.slice(1), server.endsWith('/') ? server : `${server}/`), {
    method,
    headers: { ...(contentType ? { 'content-type': contentType } : {}), 'x-api-key': key },
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

/** A picture Squirrelcade keeps (a video's thumbnail, a magazine's page), as a data: address for the drawer's frame. */
async function picture(url) {
  const { server, key } = await chrome.storage.local.get(['server', 'key']);
  if (!server || !key || typeof url !== 'string' || !url.startsWith('/api/v1/')) return null;
  const res = await fetch(new URL(url.slice(1), server.endsWith('/') ? server : `${server}/`), { headers: { 'x-api-key': key } });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** Today's exchange rate (Frankfurter, api.frankfurter.dev: the European Central Bank's, no account), kept for the day. */
async function rate(from, to) {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const day = new Date().toISOString().slice(0, 10);
  const key = `rate:${from}:${to}`;
  const kept = (await chrome.storage.local.get(key))[key];
  if (kept?.day === day) return kept.rate;
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`);
  if (!res.ok) return kept?.rate ?? null;
  const r = (await res.json()).rates?.[to] ?? null;
  if (r) await chrome.storage.local.set({ [key]: { day, rate: r } });
  return r;
}

const unescape = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
const cents = (s) => {
  const m = /\$\s*([\d,]+\.\d\d)/.exec(s ?? '');
  return m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : null;
};
const words = (s) => ` ${(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * PriceCharting's loose, complete and new prices, read from its search page (one page, when you click the button):
 * the products it lists, best first (the console and title that match the listing's).
 */
async function prices(url, title, platform) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return { error: `PriceCharting answered ${res.status}.`, url };
  const html = await res.text();
  // One result: PriceCharting goes straight to the game's page.
  if (/id="used_price"/.test(html)) {
    const cell = (id) => cents(new RegExp(`id="${id}"[\\s\\S]*?<span class="price js-price">([^<]*)<`).exec(html)?.[1]);
    const name = unescape(/<h1[^>]*id="product_name"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? title);
    return { url: res.url, products: [{ title: name, console: platform ?? '', url: res.url, loose: cell('used_price'), cib: cell('complete_price'), new: cell('new_price') }] };
  }
  const products = [];
  for (const m of html.matchAll(/<tr id="product-\d+"[\s\S]*?<\/tr>/g)) {
    const row = m[0];
    const link = /<td class="title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!link) continue;
    const price = (cls) => cents(new RegExp(`class="price numeric ${cls}"[\\s\\S]*?<span class="js-price">([^<]*)<`).exec(row)?.[1]);
    products.push({
      title: unescape(link[2]),
      console: unescape(/<td class="console[^"]*">([\s\S]*?)<\/td>/.exec(row)?.[1] ?? ''),
      url: new URL(link[1], 'https://www.pricecharting.com/').href,
      loose: price('used_price'),
      cib: price('cib_price'),
      new: price('new_price'),
    });
    if (products.length >= 8) break;
  }
  const t = words(title);
  const p = words(platform);
  const score = (x) => (words(x.title) === t ? 2 : 0) + (platform && words(x.console) === p ? 3 : 0);
  products.sort((a, b) => score(b) - score(a));
  return { url, products: products.slice(0, 3) };
}
