// The extension's options: your Squirrelcade's address and API key, kept in this browser only (chrome.storage.local).
const $ = (id) => document.getElementById(id);
const status = (text, ok) => {
  $('status').textContent = text;
  $('status').className = ok ? 'ok' : 'bad';
};

chrome.storage.local.get(['server', 'key']).then(({ server, key }) => {
  if (server) $('server').value = server;
  if (key) $('key').value = key;
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let server;
  try {
    server = new URL($('server').value.trim());
  } catch {
    status('That address isn’t a web address.', false);
    return;
  }
  const key = $('key').value.trim();
  // The extension may talk to that address only (asked once, by the browser).
  const granted = await chrome.permissions.request({ origins: [`${server.protocol}//${server.hostname}/*`] });
  if (!granted) {
    status('The browser needs your permission to reach Squirrelcade.', false);
    return;
  }
  await chrome.storage.local.set({ server: server.href, key });
  status('Testing…', true);
  try {
    const res = await fetch(new URL('api/v1/deal-check', server.href), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ items: [{ title: 'Super Mario Bros.', platform: 'NES' }] }),
    });
    if (res.ok) status('Saved. Squirrelcade answered: you’re ready.', true);
    else if (res.status === 401 || res.status === 403) status('Saved, but Squirrelcade turned the key down.', false);
    else if (res.status === 404) status('Saved, but this Squirrelcade has no Deal check yet: update it.', false);
    else status(`Saved, but Squirrelcade answered ${res.status}.`, false);
  } catch {
    status('Saved, but Squirrelcade didn’t answer at that address.', false);
  }
});
