// The toolbar button's window (it took the corner bar's place, the owner's wish, 2026-11-24): what Deal check found on
// this tab, Check again (or Check this page where no reader runs), Copy for Claude, the store's Auto switch.
const $ = (id) => document.getElementById(id);
let tabId = null;

/** Asks the tab's page script; null when Deal check isn't on that page yet. */
async function ask(message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

function show(state) {
  const checkBtn = $('check');
  if (!state) {
    $('store').textContent = '';
    $('message').textContent = 'Deal check hasn’t looked at this page. Select some titles if it isn’t a store it reads, then check it.';
    $('message').className = 'message';
    $('counts').hidden = true;
    checkBtn.textContent = 'Check this page';
    for (const id of ['copy', 'auto', 'clear']) $(id).hidden = true;
    return;
  }
  $('store').textContent = state.store ?? '';
  $('message').textContent = state.message ?? (state.autoAvailable ? (state.auto ? 'Checking this page by itself…' : 'Auto is off on this store.') : 'Not checked yet.');
  $('message').className = state.needsOptions || /didn’t answer|turned the key down|update it/.test(state.message ?? '') ? 'message bad' : 'message';
  $('counts').hidden = !state.games;
  $('games').textContent = state.games;
  $('mine').textContent = state.mine;
  $('wanted').textContent = state.wanted;
  checkBtn.textContent = 'Check again';
  $('copy').hidden = !state.games;
  $('clear').hidden = !state.games;
  $('auto').hidden = !state.autoAvailable;
  $('auto').textContent = `Auto: ${state.auto ? 'on' : 'off'}`;
  const extra = [state.coming ? `${state.coming} on the way to you` : '', state.unsure ? `${state.unsure} to check (L)` : '', state.leftOut ? `${state.leftOut} not games left out` : ''].filter(Boolean);
  $('extra').hidden = extra.length === 0;
  $('extra').textContent = extra.join(' · ');
  if (state.needsOptions) {
    $('extra').hidden = false;
    $('extra').textContent = 'Check the address and key in Options.';
  }
}

async function busy(button, label, work) {
  const was = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await work();
  } finally {
    button.disabled = false;
    if (button.textContent === label) button.textContent = was;
  }
}

$('check').addEventListener('click', () =>
  busy($('check'), 'Checking…', async () => {
    let state = await ask({ type: 'rescan' });
    if (!state) {
      // Not on the page yet (a site it doesn't read by itself): put it there to read the selection.
      await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__squirrelcadeManual = true; } });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 1500));
      state = await ask({ type: 'window' });
    }
    show(state);
  }),
);

$('copy').addEventListener('click', () =>
  busy($('copy'), 'Copying…', async () => {
    const answer = await ask({ type: 'copyText' });
    if (!answer?.text) return;
    try {
      await navigator.clipboard.writeText(answer.text);
      $('copy').textContent = `Copied ${answer.count}: paste it into Claude`;
    } catch {
      $('copy').textContent = 'The browser wouldn’t copy';
    }
  }),
);

$('auto').addEventListener('click', () => busy($('auto'), 'Auto: …', async () => show(await ask({ type: 'toggleAuto' }))));
$('clear').addEventListener('click', async () => show(await ask({ type: 'clearBadges' })));
$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const { server, key, updated } = await chrome.storage.local.get(['server', 'key', 'updated']);
  if (updated) {
    $('updated').hidden = false;
    $('updated').textContent = `Deal check updated itself to ${updated}.`;
    await chrome.storage.local.remove('updated');
  }
  if (!server || !key) {
    $('message').textContent = 'Set your Squirrelcade’s address and API key first.';
    $('check').textContent = 'Open Options';
    $('check').onclick = () => chrome.runtime.openOptionsPage();
    return;
  }
  show(await ask({ type: 'window' }));
})();
