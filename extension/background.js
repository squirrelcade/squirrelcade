// Squirrelcade Deal check: the toolbar button, and the two things a store's page can't do itself (D245):
// ask your Squirrelcade (with the key from the extension's options) and read PriceCharting's prices for a game.
// Nothing runs until you press the button, and only on the tab you pressed it on.

const BATCH = 50;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const { server, key } = await chrome.storage.local.get(['server', 'key']);
  if (!server || !key) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
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
    results.push(...(await res.json()).results);
  }
  return { results };
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
