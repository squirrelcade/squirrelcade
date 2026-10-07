// The interface in a real browser, after the smoke test's fresh install: signs in through the sign-in page,
// opens every page, the game drawer and the header's search, and fails on anything a page throws, a page that
// can't be shown, or a server error. The smoke test runs it at its end when SMOKE_UI=1:
//   SMOKE_UI=1 node scripts/smoke-test.mjs http://127.0.0.1:7575
// It drives a browser that's already installed (no download): Chrome, or another with UI_BROWSER=msedge; or, with
// UI_BROWSER=webkit, Playwright's WebKit (Safari's engine, what an iPhone runs; `npx playwright-core install webkit`
// downloads it once, about 60 MB, into the ms-playwright folder). With
// UI_VIDEO=<folder> it keeps a video of every page it drives there (.webm, encoded by Playwright's own ffmpeg, which
// lives in the ms-playwright folder shared by the projects on this PC).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, webkit } from 'playwright-core';

/** The browser the walk-throughs drive; with UI_VIDEO=<folder>, each page it opens is recorded there. */
async function launch() {
  const name = process.env.UI_BROWSER || 'chrome';
  const browser = name === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: name, headless: true });
  const dir = process.env.UI_VIDEO;
  if (dir) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (options = {}) => newContext({ ...options, recordVideo: { dir, size: options.viewport ?? { width: 1280, height: 800 } } });
  }
  return browser;
}

/** Closes each page's context first (a video is written when its context closes), then the browser. */
async function finish(browser) {
  for (const context of browser.contexts()) await context.close().catch(() => undefined);
  await browser.close();
}

/** Every settings page, read from the list the settings area is built from. */
function settingsPages() {
  const source = readFileSync(new URL('../packages/core/src/settingsPages.ts', import.meta.url), 'utf8');
  return [...source.matchAll(/\{ id: '([a-z-]+)'/g)].map((m) => `/settings/${m[1]}`);
}

/**
 * A fresh install's first run, as a new owner meets it: the setup page creates the account (its two steps), and
 * the new install opens on the welcome guide. The smoke test runs it instead of creating the account by the API.
 */
export async function setupTest(target, account, check) {
  const base = target.replace(/\/+$/, '');
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })).newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`thrown: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && problems.push(`console: ${m.text()}`));
    page.on('response', (r) => r.status() >= 500 && problems.push(`server error ${r.status()}: ${r.url().replace(base, '')}`));
    await page.goto(`${base}/`);
    await page.getByLabel('Username').fill(account.username);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByLabel('Password again').fill(account.password);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Create account and start' }).click();
    await page.waitForURL(/\/welcome$/, { timeout: 15000 });
    await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 10000 });
    check('ui: the setup page creates the account and opens the welcome guide', problems.length === 0, problems.join(' | '));
  } catch (err) {
    if (process.env.UI_SHOTS) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${process.env.UI_SHOTS}/setup-test-stopped.png` }).catch(() => undefined);
    check('ui: the setup page creates the account and opens the welcome guide', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  } finally {
    await finish(browser);
  }
}

/**
 * A new owner's first collection: signed in, the empty install opens on the welcome guide, which takes the
 * PriceCharting export (csv, as collection_20260927.csv) and then shows the consoles to track. The smoke test
 * runs it instead of uploading the export by the API.
 */
export async function welcomeTest(target, account, csv, check) {
  const base = target.replace(/\/+$/, '');
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })).newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`thrown: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && problems.push(`console: ${m.text()}`));
    page.on('response', (r) => r.status() >= 500 && problems.push(`server error ${r.status()}: ${r.url().replace(base, '')}`));
    await page.goto(`${base}/`);
    await page.getByLabel('Username').fill(account.username);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/welcome$/, { timeout: 15000 });
    await page.locator('input[type=file]').first().setInputFiles({ name: 'collection_20260927.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByText(/rows read/).first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByText('PlayStation 3').first().waitFor({ timeout: 10000 });
    check('ui: the welcome guide takes the export and shows the consoles to track', problems.length === 0, problems.join(' | '));
  } catch (err) {
    if (process.env.UI_SHOTS) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${process.env.UI_SHOTS}/welcome-test-stopped.png` }).catch(() => undefined);
    check('ui: the welcome guide takes the export and shows the consoles to track', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  } finally {
    await finish(browser);
  }
}

/**
 * Walks the interface of the instance at target, signed in as account; each finding goes to check(name, ok, detail),
 * the smoke test's own list.
 */
export async function uiTest(target, account, check) {
  const base = target.replace(/\/+$/, '');
  const webkitRun = (process.env.UI_BROWSER || '') === 'webkit';
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })).newPage();
    let problems = [];
    // WebKit reports a request cut off by leaving the page as "... due to access control checks"; Squirrelcade calls only
    // its own address, so that's never a real access problem.
    const cutOff = (e) => webkitRun && /due to access control checks/.test(e.message);
    page.on('pageerror', (e) => !cutOff(e) && problems.push(`thrown: ${e.message}`));
    // A 4xx is an expected answer (a service not set up yet); the browser's note about it isn't a problem.
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && problems.push(`console: ${m.text()}`));
    page.on('response', (r) => r.status() >= 500 && problems.push(`server error ${r.status()}: ${r.url().replace(base, '')}`));
    // axe-core's serious and critical findings on the page: what each is, and where (the element's text and colors,
    // never its HTML, which can hold a field's value such as a key).
    const axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
    const seriousProblems = async () => {
      // Scanned once every transition has finished (a dialog fading in reads as faint text), the endless ones (a spinner)
      // aside, and at most 3 seconds.
      await page.evaluate(() =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => undefined)),
          ),
          new Promise((done) => setTimeout(done, 3000)),
        ]),
      );
      await page.addScriptTag({ path: axe });
      return page.evaluate(async () =>
        (await window.axe.run(document, { resultTypes: ['violations'] })).violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => {
            const n = v.nodes[0];
            const el = n ? document.querySelector(n.target[0]) : null;
            const where = el?.getAttribute('placeholder') || el?.closest('label, tr, p, .mantine-InputWrapper-root')?.textContent?.trim().slice(0, 50) || el?.tagName || '';
            const colors = n?.any[0]?.data?.fgColor ? ` ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor}` : '';
            return `${v.id} (${v.nodes.length})${colors}: ${where}`;
          }),
      );
    };
    // A dialog closed by its X, once the messages in the corner are gone: one can cover the X, and it stays while the
    // mouse is on it (so the mouse moves away first, as a person's would).
    const closeModal = async (modal) => {
      await page.mouse.move(5, 5);
      await page.locator('.mantine-Notification-root').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      await modal.locator('.mantine-Modal-close').click();
    };
    const settle = async () => {
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(200);
    };
    const pageProblems = async () => {
      const shown = await page.getByText("This page couldn't be shown").count();
      const found = [...problems, ...(shown > 0 ? ["the page couldn't be shown"] : [])];
      problems = [];
      return found;
    };

    await page.goto(`${base}/`);
    // The sign-in boxes are the ones password managers may fill (every other box is off-limits to them).
    const signInBoxes = await Promise.all(['Username', 'Password'].map((l) => page.getByLabel(l, { exact: true }).getAttribute('data-lpignore')));
    await page.getByLabel('Username', { exact: true }).fill(account.username);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // A new install opens on Today, the home page (2026-10-06).
    await page.locator('nav.mantine-AppShell-navbar').getByRole('link', { name: 'Today', exact: true }).waitFor({ timeout: 15000 });
    await settle();
    let found = await pageProblems();
    check('ui: signs in', found.length === 0, found.join(' | '));
    check('ui: the sign-in boxes stay open to password managers', signInBoxes.every((v) => v === 'false'), signInBoxes.join(', '));
    // The Stash's chest (D142): beside Stash in the menu, in the gamepad's place.
    const menuChests = await page.locator('nav.mantine-AppShell-navbar svg[viewBox="0 0 7 6"]').count();
    const gamepads = await page.locator('nav.mantine-AppShell-navbar .tabler-icon-device-gamepad-2').count();
    check("ui: the Stash's chest is beside Stash in the menu", menuChests >= 1 && gamepads === 0, `chests: ${menuChests}, gamepads: ${gamepads}`);

    const paths = [
      '/today',
      '/collection',
      '/collection?view=grid',
      '/wishlist',
      '/wishlist/deals',
      '/wishlist/pc',
      '/wishlist/coming-soon',
      '/wishlist/past',
      '/acorns',
      '/platforms',
      '/platforms/playstation-3',
      '/platforms/playstation-3?tab=owned',
      '/platforms/playstation-3?tab=top100',
      '/platforms/playstation-3?tab=top100&view=list',
      '/platforms/playstation-3?tab=history',
      '/platforms?view=timeline',
      '/collection/copies',
      '/collection/upgrades',
      '/collection/copies?view=multiple',
      '/collection/backlog',
      '/collection/loans',
      '/collection/sale',
      '/collection/sales',
      '/collection/statistics',
      '/collection/report',
      '/sets',
      '/sets/smoke-set',
      '/sets?tab=series',
      '/pc',
      '/pc/wishlist',
      '/pc/wishlist?view=deals',
      '/review',
      '/store',
      '/store/list',
      '/store/shelf',
      '/updates',
      '/welcome',
      '/help',
      '/help/ai-setup',
      '/help/getting-started',
      '/help/matching',
      '/help/playing',
      '/help/your-copies',
      '/help/selling',
      '/help/services',
      '/help/ai-apps',
      '/help/friends',
      '/friends',
      '/friends/1',
      '/friends/1?tab=trades',
      '/notes',
      ...settingsPages(),
      '/system/status',
      '/system/tasks',
      '/system/backups',
      '/system/logs',
    ];
    // Each page, and its serious accessibility problems (axe-core: contrast, names and labels...), listed together.
    const access = [];
    // With UI_SHOTS set to a folder, a few pages are saved as pictures there too (to look at a change of design).
    const shotPages = ['/today', '/collection', '/collection/copies', '/platforms/playstation-3', '/settings/sources', '/store'];
    for (const path of paths) {
      await page.goto(`${base}${path}`);
      await settle();
      if (process.env.UI_SHOTS && shotPages.includes(path)) await page.screenshot({ path: `${process.env.UI_SHOTS}/page${path.replace(/[^a-z0-9]+/gi, '-')}.png` });
      found = await pageProblems();
      check(`ui: ${path}`, found.length === 0, found.join(' | '));
      const serious = await seriousProblems();
      if (serious.length > 0) access.push(`${path}: ${serious.join('; ')}`);
    }
    check('ui: no serious accessibility problems', access.length === 0, access.join(' | '));

    // The menu (0.45.0): Review among System's pages, and the PC wishlist's old address leading to its place under the PC library.
    await page.goto(`${base}/review`);
    await settle();
    const systemPages = page.locator('.mantine-NavLink-children').filter({ has: page.getByRole('link', { name: 'Status', exact: true }) });
    const reviewUnderSystem = await systemPages.getByRole('link', { name: /^Review/ }).count();
    await page.goto(`${base}/wishlist/pc`);
    const pcWishlistMoved = await page.waitForURL(/\/pc\/wishlist$/, { timeout: 10000 }).then(() => true, () => false);
    check('ui: Review is under System, and the PC wishlist under the PC library', reviewUnderSystem === 1 && pcWishlistMoved, `review under System: ${reviewUnderSystem}; moved: ${pcWishlistMoved} (${page.url()})`);

    // The same in light mode (Settings > Interface), then back to the default.
    const theme = async (value) => {
      const res = await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'interface.theme': value } } });
      if (!res.ok()) throw new Error(`The theme didn't change (${res.status()})`);
    };
    await theme('light');
    const light = [];
    for (const path of paths) {
      await page.goto(`${base}${path}`);
      await settle();
      const serious = await seriousProblems();
      if (serious.length > 0) light.push(`${path}: ${serious.join('; ')}`);
    }
    await theme('dark');
    found = await pageProblems();
    check('ui: no serious accessibility problems in light mode', light.length === 0 && found.length === 0, [...light, ...found].join(' | '));

    // A game's title opens the drawer; Escape closes it.
    await page.goto(`${base}/platforms/playstation-3?tab=owned`);
    await settle();
    await page.getByRole('button', { name: 'Show Uncharted' }).first().click();
    const drawer = page.locator('.mantine-Drawer-content');
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await settle();
    found = await pageProblems();
    // Section titles are upper case on the page, and innerText gives them as shown.
    const shown = await drawer.innerText();
    check('ui: a title opens the game drawer', found.length === 0 && /your copies/i.test(shown), found.join(' | ') || (/your copies/i.test(shown) ? '' : shown.slice(0, 200)));
    // The chest before "Have it" and "You own it" in the drawer, and on the console's Owned tab (D142).
    const drawerChests = await drawer.locator('svg[viewBox="0 0 7 6"]').count();
    const tabChest = await page.getByRole('tab', { name: 'Owned', exact: true }).locator('svg[viewBox="0 0 7 6"]').count();
    check("ui: the Stash's chest marks a game you have, in the drawer and on the Owned tab", drawerChests >= 2 && tabChest === 1, `drawer: ${drawerChests}, tab: ${tabChest}`);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden', timeout: 5000 });
    check('ui: Escape closes the drawer', !new URL(page.url()).searchParams.has('game'), page.url());

    // Exclude it takes a missing game off the checklist from the bottom of its drawer, and Make it a target brings it
    // back: each asks first, and Cancel changes nothing (D145).
    const ps3Counts = async () => (await (await page.request.get(`${base}/api/v1/catalogs/playstation-3?pageSize=1`)).json()).counts;
    const countsBefore = await ps3Counts();
    await page.goto(`${base}/platforms/playstation-3?tab=missing`);
    await settle();
    const missingRow = page.locator('tbody').getByRole('button', { name: /^Show / }).first();
    const missingName = ((await missingRow.getAttribute('aria-label')) ?? '').replace(/^Show /, '');
    await missingRow.click();
    await drawer.getByRole('button', { name: 'Exclude it' }).click();
    const excludeDialog = page.getByRole('dialog', { name: 'Exclude it from the checklist?' });
    await excludeDialog.getByRole('button', { name: 'Cancel' }).click();
    await excludeDialog.waitFor({ state: 'hidden', timeout: 5000 });
    const afterCancel = await ps3Counts();
    await drawer.getByRole('button', { name: 'Exclude it' }).click();
    await excludeDialog.getByRole('button', { name: 'Exclude it' }).click();
    await drawer.getByRole('button', { name: 'Make it a target' }).waitFor({ timeout: 10000 });
    const countsExcluded = await ps3Counts();
    await drawer.getByRole('button', { name: 'Make it a target' }).click();
    await page.getByRole('dialog', { name: 'Make it a target again?' }).getByRole('button', { name: 'Make it a target' }).click();
    await drawer.getByRole('button', { name: 'Exclude it' }).waitFor({ timeout: 10000 });
    const countsBack = await ps3Counts();
    found = await pageProblems();
    check(
      'ui: Exclude it and Make it a target each ask first, from the bottom of the drawer (D145)',
      found.length === 0 &&
        afterCancel.excluded === countsBefore.excluded &&
        countsExcluded.excluded === countsBefore.excluded + 1 &&
        countsExcluded.missing === countsBefore.missing - 1 &&
        countsBack.missing === countsBefore.missing &&
        countsBack.excluded === countsBefore.excluded,
      found.join(' | ') || `${missingName}: before ${JSON.stringify(countsBefore)}, excluded ${JSON.stringify(countsExcluded)}, back ${JSON.stringify(countsBack)}`,
    );
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden', timeout: 5000 });

    // The Top 100 tab opens as a board of ten by ten with the hunting list beside it; a square opens its game.
    await page.goto(`${base}/platforms/playstation-3?tab=top100`);
    await page.getByRole('heading', { name: 'Hunting list' }).waitFor({ timeout: 15000 });
    const squares = await page.locator('button.sc-square').count();
    await page.locator('button.sc-square').first().click();
    const squareOpens = await drawer.waitFor({ timeout: 10000 }).then(() => true, () => false);
    found = await pageProblems();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    check('ui: the Top 100 as a board of 100 squares, with the hunting list; a square opens its game', found.length === 0 && squares === 100 && squareOpens, found.join(' | ') || `${squares} squares, drawer ${squareOpens}`);

    // The Top 100 tab's list: every "Write why it matters" starts at the same place, under its game's title (it wandered
    // when a long line of developers stretched it).
    await page.goto(`${base}/platforms/playstation-3?tab=top100&view=list`);
    await page.getByText(/^Own \d+ of 100/).waitFor({ timeout: 15000 });
    const whyLefts = await page.getByRole('button', { name: 'Write why it matters' }).evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().left)))]);
    // Every link that is a button keeps its words at the start (where there's no why to write yet, the links line up).
    const centered = await page.locator('button.mantine-Anchor-root').evaluateAll((els) => els.filter((el) => getComputedStyle(el).textAlign === 'center').map((el) => el.textContent));
    const anchorButtons = await page.locator('button.mantine-Anchor-root').count();
    check('ui: "Write why it matters" lines up on every Top 100 row', anchorButtons > 0 && centered.length === 0 && whyLefts.length <= 1, `link buttons: ${anchorButtons}; centered: ${centered.slice(0, 3).join(', ') || 'none'}; left edges: ${whyLefts.join(', ') || 'none'}`);

    // The Top 100 tab: Journey is ranked, owned, and says why it matters; its title opens the drawer, which says so too.
    await page.goto(`${base}/platforms/playstation-3?tab=top100&view=list&show=owned`);
    await page.getByText(/^Own \d+ of 100/).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Show Journey' }).first().click();
    await drawer.getByText("in the console's Top 100").waitFor({ timeout: 10000 });
    await settle();
    found = await pageProblems();
    const why = await drawer.innerText();
    check('ui: the Top 100 opens a game whose drawer says why it matters', found.length === 0 && /wordless/i.test(why), found.join(' | ') || why.slice(0, 200));
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden', timeout: 5000 });

    // The owner's version of why a game matters: written in its modal, verified, shown on the list.
    await page.goto(`${base}/platforms/playstation-3?tab=top100&view=list&show=missing`);
    await page.getByText(/^Own \d+ of 100/).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /^Edit why .* matters$/ }).first().click();
    const whyModal = page.getByRole('dialog');
    await whyModal.getByLabel('Why it matters').fill('A test note written by the walk-through.');
    await whyModal.getByLabel('Verified: I checked it against its sources').check();
    await whyModal.getByRole('button', { name: 'Save' }).click();
    // The row shows the new text marked verified (waiting for the list to come back with it).
    const edited = page.locator('tr', { hasText: 'A test note written by the walk-through.' });
    const verifiedShown = await edited
      .getByText('Verified', { exact: true })
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    found = await pageProblems();
    check("ui: the owner writes why a game matters on the Top 100", found.length === 0 && verifiedShown, found.join(' | ') || 'no Verified mark');

    // A console's history: marked verified from its menu.
    await page.goto(`${base}/platforms/playstation-3?tab=history`);
    await page.getByText('Start here').first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'History actions' }).click();
    await page.getByRole('menuitem', { name: /Mark verified/ }).click();
    await page.getByText('Your version').first().waitFor({ timeout: 10000 });
    found = await pageProblems();
    check("ui: the owner marks a console's history verified", found.length === 0, found.join(' | '));

    // Copies: a copy is said to be a different game, then put back.
    await page.goto(`${base}/collection/copies?view=all`);
    const uncharted = page.getByRole('button', { name: 'Uncharted (PlayStation 3), PlayStation 3 · CIB: what to do' });
    await uncharted.waitFor({ timeout: 15000 });
    await uncharted.click();
    await page.getByRole('menuitem', { name: /different game/ }).click();
    await page.getByText(/stands on its own now/).waitFor({ timeout: 10000 });
    await uncharted.click();
    await page.getByRole('menuitem', { name: 'Put it back with its title' }).click();
    await page.getByText(/is back with its title/).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: a copy is said to be another game on the Copies page, and put back', found.length === 0, found.join(' | '));

    // Settings > Features: the PC library switched off leaves the menu, and comes back when switched on.
    await page.goto(`${base}/settings/features`);
    await page.getByText('What Squirrelcade needs').waitFor({ timeout: 15000 });
    const pcSwitch = page.getByRole('switch', { name: 'PC library (Playnite)' });
    // The page's own Save (a part's setup under its switch has a "Save and test" of its own).
    const saveFeatures = async () => {
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'detached', timeout: 10000 });
    };
    const pcEntry = page.locator('nav.mantine-AppShell-navbar').getByText('PC library', { exact: true });
    await pcSwitch.click({ force: true });
    await saveFeatures();
    const pcHidden = await pcEntry.first().waitFor({ state: 'detached', timeout: 10000 }).then(
      () => true,
      () => false,
    );
    await pcSwitch.click({ force: true });
    await saveFeatures();
    const pcBack = await pcEntry.first().waitFor({ timeout: 10000 }).then(
      () => true,
      () => false,
    );
    found = await pageProblems();
    check('ui: switching the PC library off takes it out of the menu, and on brings it back', found.length === 0 && pcHidden && pcBack, found.join(' | ') || `hidden: ${pcHidden}, back: ${pcBack}`);

    // Each part has one home: on Settings > Features its switch links to its card, with no key boxes there; the card
    // on Sources has the switch, the steps (folded under "Set it up") and the key, off or on (PC game prices: its key).
    await page.goto(`${base}/settings/features`);
    await page.getByRole('link', { name: 'Set it up on Settings › Sources' }).first().waitFor({ timeout: 15000 });
    const keyBoxesOnFeatures = await page.getByLabel('API key', { exact: true }).count();
    await page.locator('#setting-features\\.itad').getByRole('link', { name: 'Set it up on Settings › Sources' }).click();
    await page.waitForURL(/\/settings\/sources#setting-features\.itad$/, { timeout: 10000 });
    // It scrolls smoothly to the switch: the click waits until the switch is on screen and the page has stood still for 300 ms.
    await page.getByRole('switch', { name: 'PC game prices (IsThereAnyDeal)' }).waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForFunction(
      () =>
        new Promise((done) => {
          const y = window.scrollY;
          setTimeout(() => {
            const r = document.getElementById('setting-features.itad')?.getBoundingClientRect();
            done(Boolean(r) && window.scrollY === y && r.top >= 0 && r.top < window.innerHeight);
          }, 300);
        }),
      undefined,
      { timeout: 10000, polling: 100 },
    );
    const itadCard = page.locator('.mantine-Card-root', { has: page.locator('#setting-features\\.itad') });
    // Waited for: WebKit can draw the card's fields a moment after the card itself.
    const keyWhileOff = await itadCard
      .getByLabel('API key', { exact: true })
      .waitFor({ timeout: 5000 })
      .then(() => itadCard.getByLabel('API key', { exact: true }).count(), () => 0);
    await itadCard.getByRole('button', { name: /Set it up, step by step/ }).click();
    const stepsLink = await itadCard.getByRole('link', { name: 'IsThereAnyDeal: My apps' }).getAttribute('href');
    await page.getByRole('switch', { name: 'PC game prices (IsThereAnyDeal)' }).click({ force: true });
    const itadKey = itadCard.getByLabel('API key', { exact: true });
    await settle();
    const setupAccess = await seriousProblems();
    if (process.env.UI_SHOTS) await itadCard.screenshot({ path: `${process.env.UI_SHOTS}/sources-itad-card.png` });
    await itadKey.fill('a-made-up-test-key');
    await saveFeatures();
    await page.goto(`${base}/settings/sources`);
    const sourcesKey = page.locator('#setting-sources\\.itadKey');
    await sourcesKey.waitFor({ timeout: 10000 });
    const keySaved = (await sourcesKey.getByLabel('API key', { exact: true }).getAttribute('placeholder')) === 'Saved. Type a new one to replace it.';
    // Password managers (LastPass above all) leave every box here alone, the key boxes and the game search included;
    // a saved key shows its check mark.
    const fillable = await page.evaluate(() =>
      [...document.querySelectorAll('input, textarea')]
        .filter((el) => !['hidden', 'checkbox', 'radio', 'file'].includes(el.type) && el.getAttribute('data-lpignore') !== 'true')
        .map((el) => el.getAttribute('aria-label') || el.id || el.type),
    );
    const search = page.getByLabel('Find a game', { exact: true });
    const searchMarked = (await search.getAttribute('type')) === 'search' && (await search.getAttribute('data-1p-ignore')) !== null;
    const checkMarks = await sourcesKey.locator('.tabler-icon-circle-check-filled').count();
    // Back off, as it was.
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'features.itad': false, 'sources.itadKey': '' } } });
    found = await pageProblems();
    check(
      "ui: a part's card on Sources has its switch, its steps and its key, off or on; Features only links to it",
      found.length === 0 && keySaved && keyBoxesOnFeatures === 0 && keyWhileOff === 1 && stepsLink === 'https://isthereanydeal.com/apps/my/',
      found.join(' | ') || `key saved: ${keySaved}; key boxes on Features: ${keyBoxesOnFeatures}; key while off: ${keyWhileOff}; steps link: ${stepsLink}`,
    );
    check('ui: password managers leave every box on Sources alone, the game search too; a saved key has its check mark', fillable.length === 0 && searchMarked && checkMarks === 1, `fillable: ${fillable.join(', ') || 'none'}; search marked: ${searchMarked}; check marks: ${checkMarks}`);

    // Xbox achievements, PlayStation trophies and Steam achievements: their cards on Sources show their keys while off,
    // and turned on (left unsaved: no service is asked), their test buttons.
    await page.goto(`${base}/settings/sources`);
    await page.getByLabel('OpenXBL API key').waitFor({ timeout: 15000 });
    await page.getByLabel('Sign-in token (NPSSO)').waitFor({ timeout: 5000 });
    await page.getByLabel('Steam Web API key', { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('textbox', { name: 'Your Steam profile' }).waitFor({ timeout: 5000 });
    for (const name of ['Xbox achievements', 'PlayStation trophies', 'Steam achievements']) await page.getByRole('switch', { name }).click({ force: true });
    const achievementButtons = await page.getByRole('button', { name: 'Save and test' }).count();
    await settle();
    const achievementAccess = await seriousProblems();
    found = await pageProblems();
    await page.goto(`${base}/settings/general`);
    check('ui: Xbox, PlayStation and Steam achievements show what they need on their cards', found.length === 0 && achievementAccess.length === 0 && achievementButtons >= 3, [...found, ...achievementAccess].join(' | ') || `${achievementButtons} test buttons`);
    check('ui: no serious accessibility problems in a part\'s setup', setupAccess.length === 0, setupAccess.join('; '));

    // Settings > Sources > Catalog sources: a CSV file added as a source of its own after a preview of what it has
    // (a console the demo collection doesn't collect, so no catalog is rebuilt). It joins the order at the bottom without
    // an unsaved change, its details change how its games count, and it can be removed.
    await page.goto(`${base}/settings/sources`);
    await page.getByRole('button', { name: 'Add a source' }).click();
    const addSource = page.getByRole('dialog', { name: 'Add a catalog source' });
    await addSource.getByText('A CSV file', { exact: true }).click();
    await addSource.locator('input[type=file]').setInputFiles({ name: 'walkthrough-pal.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,Platform,Region,Release date\nWalkthrough Racer,Sega Saturn,PAL,1997-05-01\nWalkthrough Quest,Saturn,PAL,1998-02-01\n') });
    await addSource.getByText('2 games found').waitFor({ timeout: 10000 });
    const sourcePreview = await addSource.innerText();
    const sourceAccess = await seriousProblems();
    await addSource.getByRole('button', { name: 'Add it' }).click();
    await addSource.waitFor({ state: 'detached', timeout: 10000 });
    const addedRow = page.locator('.mantine-Paper-root:not(.mantine-Card-root)', { hasText: 'walkthrough-pal' });
    await addedRow.waitFor({ timeout: 10000 });
    const addedUnsaved = await page.getByText(/unsaved change/).count();
    await addedRow.getByRole('button', { name: 'Details' }).click();
    await addedRow.getByText('Counts once owned').click();
    const countsChanged = await page
      .getByText('Its games now count once you own one')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false);
    page.once('dialog', (d) => void d.accept());
    await addedRow.getByRole('button', { name: 'Remove' }).click();
    await addedRow.waitFor({ state: 'detached', timeout: 10000 });
    found = await pageProblems();
    check(
      'ui: a CSV file added as a catalog source, after a preview, then changed and removed',
      found.length === 0 && sourceAccess.length === 0 && /For Sega Saturn 2/.test(sourcePreview) && /Europe 2/.test(sourcePreview) && addedUnsaved === 0 && countsChanged,
      [...found, ...sourceAccess].join(' | ') || `preview: ${sourcePreview.replace(/\s+/g, ' ').slice(0, 200)}; unsaved: ${addedUnsaved}; counts changed: ${countsChanged}`,
    );

    // Help: the "?" on a page opens its guide.
    await page.goto(`${base}/collection/copies`);
    await page.getByRole('link', { name: 'Help for this page' }).first().click();
    await page.waitForURL(/\/help\/collection$/, { timeout: 10000 });
    await page.getByRole('heading', { name: 'Your collection' }).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check("ui: a page's ? opens its guide", found.length === 0, found.join(' | '));

    // The drawer's answers: "I bought it" adds a copy of a missing game, and "take back" takes it back.
    const added = await page.request.post(`${base}/api/v1/catalogs/playstation-3/entries`, { data: { title: 'Smoke Test Adventure' } });
    if (!added.ok()) throw new Error(`Couldn't add a game to try the drawer with (${added.status()})`);
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Smoke Test Adventure')}`);
    await drawer.getByText('Missing').first().waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'I bought it' }).click();
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    const bought = /Added in Squirrelcade: not on PriceCharting yet/.test(await drawer.innerText());
    await drawer.getByText('take back').click();
    await drawer.getByText('Missing').first().waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: "I bought it" and take back in the drawer', bought && found.length === 0, found.join(' | '));

    // Add a copy from the drawer (a second one, loose, with what was paid): Collection updates lists it for PriceCharting.
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Okami')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Add a copy' }).click();
    const addCopy = page.locator('.mantine-Modal-content', { hasText: 'Add a copy' });
    await addCopy.getByLabel('Condition').click();
    await page.getByRole('option', { name: 'Loose' }).click();
    await addCopy.getByLabel(/Price paid/).fill('12.50');
    await addCopy.getByRole('button', { name: 'Add it' }).click();
    await addCopy.waitFor({ state: 'detached', timeout: 10000 });
    await drawer.getByText('Added in Squirrelcade: not on PriceCharting yet').waitFor({ timeout: 10000 });
    await page.goto(`${base}/updates`);
    const sendCard = page.locator('#send');
    await sendCard.getByText('Okami Playstation 3', { exact: false }).first().waitFor({ timeout: 10000 });
    const lines = await sendCard.getByRole('textbox', { name: "Lines for PriceCharting's importer" }).inputValue();
    await sendCard.getByRole('button', { name: "I've added them there" }).click();
    await sendCard.getByText(/Sent, waiting for an export/).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: a copy added in the drawer is listed for PriceCharting, and marked sent', found.length === 0 && lines.includes('Okami Playstation 3'), found.join(' | ') || lines);

    // "Add to a set" from the drawer: the game then says it's in the set.
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Add to a set' }).click();
    await page.getByRole('menuitem', { name: 'Smoke set' }).click();
    await drawer.getByText('In your set').waitFor({ timeout: 10000 });
    // The open drawer, and the notification adding to a set shows, have no serious accessibility problems either.
    await settle();
    const drawerAccess = await seriousProblems();
    check('ui: no serious accessibility problems in the game drawer', drawerAccess.length === 0, drawerAccess.join('; '));
    // ...and takes it out again.
    await drawer.getByRole('button', { name: 'take out' }).click();
    await drawer.getByText('In your set').waitFor({ state: 'detached', timeout: 10000 });
    found = await pageProblems();
    check('ui: the drawer adds a game to a set and takes it out', found.length === 0, found.join(' | '));

    // A note on the game, written and saved in the drawer (Store Mode and Your notes show it, below).
    await drawer.getByLabel('Your note').fill('Look for the one with the art book');
    await drawer.getByRole('button', { name: 'Save note' }).click();
    await drawer.getByRole('button', { name: 'Remove' }).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: the drawer saves a note', found.length === 0, found.join(' | '));
    // Shop links (Settings > Interface), folded under "Shop for it" by group: by default, eBay's search for the game on its console.
    await drawer.getByRole('button', { name: /^Shop for it/ }).click();
    await drawer.getByText('Used marketplaces').waitFor({ timeout: 5000 });
    const shop = await drawer.getByRole('link', { name: 'eBay' }).getAttribute('href');
    check('ui: the drawer links to a shop search for the game', /^https:\/\/www\.ebay\.com\/sch\/i\.html\?_nkw=Uncharted\+PlayStation%203$/.test(shop ?? ''), String(shop));

    // What you played: marked beaten in the drawer, the game is on the Backlog page's Beaten tab.
    await drawer.getByLabel('What you played of Uncharted').click();
    await page.getByRole('option', { name: 'Beaten' }).click();
    await drawer.getByText(/^finished /).waitFor({ timeout: 10000 });
    await page.goto(`${base}/collection/backlog?status=beaten`);
    await page.getByRole('button', { name: 'Show Uncharted' }).first().waitFor({ timeout: 10000 });
    // "What to play next" picks a game from the backlog.
    await page.goto(`${base}/collection/backlog`);
    await page.getByRole('button', { name: 'Pick one' }).click();
    await page.getByRole('button', { name: 'Start playing' }).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: a game marked beaten in the drawer is on the Backlog page, and What to play next picks one', found.length === 0, found.join(' | '));

    // A copy's details from the drawer: where it's kept, and lent to someone; the Loans page lists it.
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Change it, where it is, lending, photos...' }).first().click();
    const copyModal = page.locator('.mantine-Modal-content');
    const place = copyModal.getByLabel('Where it is');
    await place.fill('Shelf A');
    // WebKit now and then empties the place typed in the first moment after the window opens (the drawer isn't redrawn,
    // and the window's saved values were already in): it's typed again then, and noted, so the save below still tests saving.
    await page.waitForTimeout(400);
    if ((await place.inputValue()) !== 'Shelf A') {
      console.log("note ui: the place typed in a copy's window was emptied once; typed again");
      await place.fill('Shelf A');
    }
    // What was sent and answered, and whether the drawer was redrawn meanwhile, to tell why if the place doesn't show
    // (WebKit lost it now and then before 0.35.1: the field was empty when saved).
    await page.evaluate(() => document.querySelector('.mantine-Drawer-body > *')?.setAttribute('data-ui-mark', '1'));
    const placeSaved = page.waitForResponse((r) => r.url().endsWith('/api/v1/copy') && r.request().method() === 'PUT', { timeout: 10000 }).catch(() => null);
    await copyModal.getByRole('button', { name: 'Save', exact: true }).click();
    const placeResponse = await placeSaved;
    await drawer
      .getByText('Shelf A')
      .waitFor({ timeout: 10000 })
      .catch(async (err) => {
        const field = await copyModal.getByLabel('Where it is').inputValue().catch(() => '?');
        const sent = placeResponse ? `${placeResponse.status()} ${(placeResponse.request().postData() ?? '').slice(0, 160)}` : 'no request';
        const redrawn = await page.evaluate(() => !document.querySelector('[data-ui-mark="1"]'));
        throw new Error(`${err.message.split('\n')[0]} | the field: "${field}" | the save: ${sent} | drawer redrawn: ${redrawn} | ${page.url()}`);
      });
    await copyModal.getByLabel('Lend it to').fill('Sam');
    await copyModal.getByRole('button', { name: 'Lend', exact: true }).click();
    await copyModal.getByRole('button', { name: "It's back" }).waitFor({ timeout: 10000 });
    await settle();
    const copyAccess = await seriousProblems();
    await closeModal(copyModal);
    await drawer.getByText(/^Lent to Sam/).waitFor({ timeout: 10000 });
    await page.goto(`${base}/collection/loans`);
    await page.getByRole('cell', { name: 'Sam', exact: true }).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check("ui: a copy's place and a loan saved from the drawer, and the Loans page lists it", found.length === 0, found.join(' | '));
    check("ui: no serious accessibility problems in a copy's details", copyAccess.length === 0, copyAccess.join('; '));

    // Tested from the drawer in one tap; a standard photo taken in its place in the copy's window.
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'tested: it works' }).first().click();
    await drawer.getByText(/^Tested .*: works$/).first().waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Change it, where it is, lending, photos...' }).first().click();
    const careModal = page.locator('.mantine-Modal-content');
    await careModal.getByRole('button', { name: 'Take Box front' }).waitFor({ timeout: 10000 });
    const slotPhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), careModal.getByRole('button', { name: 'Take Box front' }).click()]);
    await chooser.setFiles({ name: 'front.png', mimeType: 'image/png', buffer: slotPhoto });
    await careModal.getByRole('img', { name: 'Box front' }).waitFor({ timeout: 15000 });
    const tests = (await (await page.request.get(`${base}/api/v1/copy?key=${encodeURIComponent((await (await page.request.get(`${base}/api/v1/collection/items?q=Uncharted`)).json()).items[0].copyKey)}`)).json()).tests;
    await closeModal(careModal);
    found = await pageProblems();
    check('ui: a test from the drawer, and a standard photo taken in its place', found.length === 0 && tests.length === 1 && tests[0].result === 'works', found.join(' | ') || JSON.stringify(tests));

    // An estimated price only when asked: empty on a copy without a price paid until Suggest fills it; saved, it shows.
    await page.request.post(`${base}/api/v1/collection/copies`, { data: { platformKey: 'playstation-3', title: 'Estimate Test Game', completeness: 'complete' } });
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Estimate Test Game')}`);
    await drawer.getByRole('button', { name: 'Change it, where it is, lending, photos...' }).first().click();
    const estimateModal = page.locator('.mantine-Modal-content');
    const estimateField = estimateModal.getByLabel(/^Estimated price/);
    const emptyAtFirst = (await estimateField.inputValue()) === '';
    await estimateModal.getByRole('button', { name: 'Suggest', exact: true }).click();
    await estimateModal.getByText(/^Suggested: a new game on this console/).waitFor({ timeout: 10000 });
    const suggestedValue = await estimateField.inputValue();
    await estimateModal.getByRole('button', { name: 'Save the copy' }).click();
    await closeModal(estimateModal);
    await drawer.getByText(/^estimated /).waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: an estimated price only when asked: Suggest fills it, and saved it shows', found.length === 0 && emptyAtFirst && suggestedValue !== '', found.join(' | ') || `empty at first: ${emptyAtFirst}, suggested: ${suggestedValue}`);

    // Collection > Improve: what copies are missing, filled in one copy at a time.
    await page.goto(`${base}/collection/improve`);
    await page.getByRole('button', { name: 'Fill in' }).first().click();
    const walk = page.locator('.mantine-Modal-content');
    await walk.getByText(/^1 of /).waitFor({ timeout: 10000 });
    await walk.getByRole('button', { name: 'Next copy' }).click();
    await walk.getByText(/^2 of /).waitFor({ timeout: 10000 });
    await settle();
    const walkAccess = await seriousProblems();
    await closeModal(walk);
    found = await pageProblems();
    check('ui: Improve your collection opens a copy and walks to the next', found.length === 0 && walkAccess.length === 0, [...found, ...walkAccess].join(' | '));

    // Ready to sell, after a rip: the listing for eBay says the disc was read in full; Mercari has its own condition. The
    // sale recorded there is on Collection > Sales, in money and meals, and taken back; Sold in a copy's window asks too.
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Change it, where it is, lending, photos...' }).first().click();
    const ripWindow = page.getByRole('dialog', { name: /^Uncharted · / });
    await ripWindow.getByRole('button', { name: 'Read fully' }).click();
    await ripWindow.getByText(/^Ripped .*: read fully$/).first().waitFor({ timeout: 10000 });
    await ripWindow.getByRole('button', { name: 'Ready to sell' }).click();
    const sellKit = page.getByRole('dialog', { name: /^Ready to sell · Uncharted/ });
    const kitTitle = sellKit.getByRole('textbox', { name: 'Title', exact: true });
    await kitTitle.waitFor({ timeout: 10000 });
    const listedAs = await kitTitle.inputValue();
    const listedWith = await sellKit.getByRole('textbox', { name: 'Description', exact: true }).inputValue();
    await settle();
    const sellAccess = await seriousProblems();
    if (process.env.UI_SHOTS) {
      const size = page.viewportSize();
      await page.setViewportSize({ width: 1280, height: 2000 });
      await sellKit.screenshot({ path: `${process.env.UI_SHOTS}/ready-to-sell.png` });
      if (size) await page.setViewportSize(size);
    }
    await sellKit.getByRole('tab', { name: 'Mercari' }).click();
    await sellKit.getByText(/Condition: Good\./).waitFor({ timeout: 10000 });
    await sellKit.getByRole('textbox', { name: /^Sold for/ }).fill('30');
    await sellKit.getByRole('button', { name: 'Record the sale' }).click();
    await sellKit.waitFor({ state: 'hidden', timeout: 10000 });
    await ripWindow.waitFor({ state: 'hidden', timeout: 10000 });
    await page.goto(`${base}/collection/sales`);
    await page.getByRole('button', { name: 'take back' }).first().waitFor({ timeout: 10000 });
    const salesShown = await page.locator('main').innerText();
    const risingTab = await page.getByRole('tab', { name: /^Worth more lately \(\d+\)$/ }).count();
    await settle();
    const salesAccess = await seriousProblems();
    if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/sales.png`, fullPage: true });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'take back' }).first().click();
    await page.getByText(/^Nothing sold yet/).waitFor({ timeout: 10000 });
    await page.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    await drawer.getByRole('button', { name: 'Change it, where it is, lending, photos...' }).first().click();
    await ripWindow.getByRole('button', { name: 'Sold', exact: true }).click();
    const soldAsk = page.getByRole('dialog', { name: /^It sold · Uncharted/ });
    await soldAsk.getByRole('button', { name: 'Take it out without a sale' }).waitFor({ timeout: 10000 });
    const soldAsksOnly = (await soldAsk.getByRole('textbox', { name: 'Title', exact: true }).count()) === 0;
    await closeModal(soldAsk);
    await closeModal(ripWindow);
    found = await pageProblems();
    check(
      'ui: Ready to sell writes the listing (tested and ripped), the sale is on Sales in meals and taken back, and Sold asks what it sold for',
      found.length === 0 &&
        sellAccess.length === 0 &&
        salesAccess.length === 0 &&
        /^Uncharted \(PlayStation 3.*\) .*Tested$/.test(listedAs) &&
        listedWith.includes('The disc was read in full and verified without errors on') &&
        /1 sold · 1 meal/.test(salesShown) &&
        risingTab === 1 &&
        soldAsksOnly,
      [...found, ...sellAccess, ...salesAccess].join(' | ') || `${listedAs} | ${listedWith.slice(0, 160)} | ${salesShown.slice(0, 200)} | Sold asks only: ${soldAsksOnly}`,
    );

    // A goal for the collection, set on its settings page: Today and Statistics show how far it is, then it's taken off.
    await page.goto(`${base}/settings/collection`);
    const goalField = page.getByLabel("Your collection's goal");
    await goalField.fill('50');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText(/unsaved change/).waitFor({ state: 'detached', timeout: 10000 });
    // Today says it in one small line (0.52.0); Statistics has the bar and the pace.
    await page.goto(`${base}/today`);
    const goalToday = await page.getByText(/% of your 50-copy goal/).first().innerText().catch(() => '');
    await page.goto(`${base}/collection/statistics`);
    await page.getByRole('progressbar', { name: /of 50 copies$/ }).waitFor({ timeout: 10000 });
    const goalStats = await page.getByText(/ to go. The last 12 months: /).first().innerText().catch(() => '');
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'collection.goal': 0 } } });
    found = await pageProblems();
    check(
      'ui: a goal set in Settings shows on Today in a line, and on Statistics with its pace',
      found.length === 0 && /% of your 50-copy goal/.test(goalToday) && /to go/.test(goalStats),
      found.join(' | ') || `${goalToday} / ${goalStats}`,
    );

    // Today as the redesign draws it (0.48.0): a greeting, the week's releases, the last update and the collection's pulse.
    await page.goto(`${base}/today`);
    await page.getByRole('heading', { name: 'Your collection' }).waitFor({ timeout: 10000 });
    const hello = await page.locator('h1.sc-hello').innerText();
    const todayHeads = await page.getByRole('heading', { level: 2 }).allInnerTexts();
    found = await pageProblems();
    check(
      'ui: Today greets you, with the week, the last update and the collection',
      found.length === 0 && /^Good (morning|afternoon|evening)/.test(hello) && ['Out this week', 'Last collection update', 'Your collection'].every((h) => todayHeads.includes(h)),
      found.join(' | ') || `${hello} / ${todayHeads.join(' / ')}`,
    );

    // A share link for the wishlist, made on its page, opens for someone who isn't signed in.
    await page.goto(`${base}/wishlist`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const shareModal = page.locator('.mantine-Modal-content');
    const forWhom = shareModal.getByLabel('For whom');
    await forWhom.fill('Mom');
    // The name is in the field (and so in the page's state) before the link is made.
    await page.waitForFunction((el) => el?.value === 'Mom', await forWhom.elementHandle(), { timeout: 5000 });
    await shareModal.getByRole('button', { name: 'Make a link' }).click();
    await shareModal.getByText('Mom', { exact: true }).waitFor({ timeout: 10000 });
    const allLinks = await (await page.request.get(`${base}/api/v1/shares`)).json();
    const links = allLinks.filter((l) => l.name === 'Mom');
    if (links.length === 0) throw new Error(`No share link for Mom; the links: ${JSON.stringify(allLinks.map((l) => l.name))}`);
    const outsiderContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const outsider = await outsiderContext.newPage();
    outsider.on('pageerror', (e) => !cutOff(e) && problems.push(`share page thrown: ${e.message}`));
    await outsider.goto(`${base}${links[0].path}`);
    await outsider.getByRole('heading', { name: 'Wishlist' }).waitFor({ timeout: 10000 });
    await outsider.getByText(/Shared with Mom/).waitFor({ timeout: 10000 }).catch(() => undefined);
    const sharedText = await outsider.locator('body').innerText();
    const sharedWide = await outsider.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await outsiderContext.close();
    found = await pageProblems();
    check('ui: a wishlist share link opens without signing in', found.length === 0 && /Shared with Mom/.test(sharedText) && sharedWide <= 1, found.join(' | ') || `${sharedText.slice(0, 200)} (${sharedWide}px sideways)`);

    // The Excel workbook downloads from the Collection page's Download menu.
    const workbook = await page.request.get(`${base}/api/v1/export/workbook`);
    check('ui: the Excel workbook downloads', workbook.ok() && workbook.headers()['content-type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${workbook.status()} ${workbook.headers()['content-type']}`);

    // The header's search: "/" jumps to it, Enter opens the best match in the drawer.
    await page.goto(`${base}/collection`);
    await settle();
    // Under Copies: how many are duplicates (the copies beyond one of each game), linked to them; none, what PriceCharting counts.
    const sums = await (await page.request.get(`${base}/api/v1/collection/summary`)).json();
    const extra = sums.totals.repeatCopies ?? 0;
    const dupText = extra > 0 ? `${extra.toLocaleString('en-US')} duplicate${extra === 1 ? '' : 's'}` : 'What PriceCharting counts';
    const dupShown = await page
      .getByText(dupText, { exact: true })
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => true, () => false);
    const dupLink = extra > 0 ? await page.getByRole('link', { name: dupText }).getAttribute('href') : null;
    check(
      'ui: the Collection page says how many copies are duplicates',
      dupShown && (extra === 0 || dupLink === '/collection/copies?view=repeats') && extra === sums.totals.copies - sums.totals.games,
      `${dupText}; shown: ${dupShown}; link: ${dupLink}; copies ${sums.totals.copies}, games ${sums.totals.games}`,
    );
    // A heading sorts the Stash (D144): Added once is the newest first, twice the oldest, as the server orders them.
    const firstOf = async (query) => (await (await page.request.get(`${base}/api/v1/collection/items?${query}&pageSize=1`)).json()).items[0]?.title ?? '';
    const addedHeading = page.getByRole('columnheader', { name: 'Added' });
    // The rows shown stay until the new order arrives, so wait for the expected first row.
    const firstRowShows = (title) => page.locator('tbody tr').first().filter({ hasText: title }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    const headingSays = (way) => addedHeading.and(page.locator(`[aria-sort="${way}"]`)).waitFor({ timeout: 10000 }).catch(() => {});
    await addedHeading.getByRole('button').click();
    await headingSays('descending');
    const newest = await firstOf('sort=added');
    const newestFirst = newest !== '' && (await firstRowShows(newest));
    await addedHeading.getByRole('button').click();
    await headingSays('ascending');
    const oldest = await firstOf('sort=added&dir=asc');
    const oldestFirst = oldest !== '' && (await firstRowShows(oldest));
    const ariaSort = await addedHeading.getAttribute('aria-sort');
    check('ui: a heading sorts the Stash either way (Added: newest first, then oldest)', newestFirst && oldestFirst && ariaSort === 'ascending', `newest first: ${newestFirst} (${newest}), oldest first: ${oldestFirst} (${oldest}), aria-sort: ${ariaSort}`);
    await page.goto(`${base}/collection`);
    await settle();
    await page.keyboard.press('/');
    // Empty, it lists the games opened lately (the drawer just showed some).
    await page.getByText('Opened lately').waitFor({ timeout: 5000 });
    await page.keyboard.type('demons');
    await page.getByRole('option', { name: /Demons Souls/ }).first().waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter');
    await drawer.getByText('Demons Souls').first().waitFor({ timeout: 10000 });
    await settle();
    found = await pageProblems();
    check('ui: the search opens a game', found.length === 0 && new URL(page.url()).searchParams.get('game') === 'playstation-3|Demons Souls', `${page.url()} ${found.join(' | ')}`);

    // Check a list: several games at once, with and without their console, and a barcode Store Mode knows
    // (saved for Okami here), as a handheld scanner types it.
    const saved = await page.request.post(`${base}/api/v1/barcodes`, { data: { code: '012345678905', platformKey: 'playstation-3', title: 'Okami' } });
    if (!saved.ok()) throw new Error(`Couldn't save a barcode to try the list with (${saved.status()})`);
    await page.goto(`${base}/store/list`);
    await page.getByLabel('Games to check, one per line').fill('Okami (PS3)\nDemons Souls - PS3\nNothing Like This Game\n012345678905');
    await page.getByRole('button', { name: /^Check 4 games/ }).click();
    await page.getByText('Not in your catalogs').first().waitFor({ timeout: 10000 });
    const listed = await page.locator('main').innerText();
    found = await pageProblems();
    const answered = /You own it/.test(listed) && /Not in your catalogs/.test(listed) && /barcode 012345678905/.test(listed);
    check('ui: Check a list answers each line', found.length === 0 && answered, found.join(' | ') || (answered ? '' : listed.slice(0, 200)));

    // Store Mode answers a typed title.
    await page.goto(`${base}/store`);
    await page.getByPlaceholder('Barcode or title').fill('okami');
    await page.getByText('You own this').first().waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: Store Mode answers', found.length === 0, found.join(' | '));
    const verdictChest = await page.locator('.sc-verdict[data-tone="own"] svg[viewBox="0 0 7 6"]').count();
    check(`ui: Store Mode's "You own this" has the Stash's chest`, verdictChest >= 1, `chests: ${verdictChest}`);
    // A game you don't have: its price on PriceCharting one tap away; the header's camera goes to Store Mode.
    await page.getByPlaceholder('Barcode or title').fill('demons souls');
    const price = page.getByRole('link', { name: 'Price on PriceCharting' }).first();
    await price.waitFor({ timeout: 10000 });
    const priceHref = (await price.getAttribute('href')) ?? '';
    const cameraHref = await page.getByRole('link', { name: 'Store Mode: scan a game' }).getAttribute('href');
    // Each answer is a verdict on its tone (0.50.0), in the answer's own words.
    const verdict = await page.locator('.sc-verdict').first().innerText().catch(() => '');
    found = await pageProblems();
    check(
      'ui: Store Mode prices a game you need, with its verdict, and the header goes to it',
      found.length === 0 &&
        priceHref.startsWith('https://www.pricecharting.com/search-products') &&
        cameraHref === '/store?scan=1' &&
        /^(Need it|You own this|Owned on another console|Maybe owned: check|Not a collecting target|Not tracked)/.test(verdict),
      found.join(' | ') || `${priceHref} ${cameraHref} ${verdict}`,
    );
    // ...with your note on the game, which Your notes lists too.
    await page.getByPlaceholder('Barcode or title').fill('uncharted');
    await page.getByText('Your note:').first().waitFor({ timeout: 10000 });
    // Without a connection, Store Mode answers from this browser's copy of its answers, and says so.
    await page.getByText('Ready without a connection').waitFor({ timeout: 15000 });
    await page.context().setOffline(true);
    await page.getByPlaceholder('Barcode or title').fill('okam');
    await page.getByText("Squirrelcade can't be reached").waitFor({ timeout: 15000 });
    const offlineAnswer = await page.locator('main').innerText();
    found = await pageProblems();
    check('ui: Store Mode answers without a connection', found.length === 0 && /You own this/i.test(offlineAnswer), found.join(' | ') || offlineAnswer.slice(0, 300));
    // "I bought it" without a connection is kept in the browser, and counts once the connection is back.
    await page.getByPlaceholder('Barcode or title').fill('smoke test adv');
    await page.locator('.mantine-Card-root', { hasText: 'Smoke Test Adventure' }).getByRole('button', { name: 'I bought it' }).click();
    await page.getByText(/^Bought without a connection \(1\)$/).waitFor({ timeout: 10000 });
    await page.context().setOffline(false);
    await page.getByText(/is in your collection now/).first().waitFor({ timeout: 15000 });
    const purchases = await (await page.request.get(`${base}/api/v1/purchases`)).json();
    const offlinePurchase = purchases.find((x) => x.title === 'Smoke Test Adventure');
    if (!offlinePurchase) console.log('purchases after the offline buy:', JSON.stringify(purchases), await page.locator('main').innerText());
    found = await pageProblems();
    check('ui: "I bought it" without a connection counts once it\'s back', found.length === 0 && Boolean(offlinePurchase), found.join(' | ') || (offlinePurchase ? '' : 'not among the purchases'));
    // What you paid, right in the store: beside undo, saved on the copy (0.32.0).
    const boughtRow = page.locator('.mantine-Card-root', { hasText: 'Smoke Test Adventure' }).first();
    await boughtRow.getByRole('button', { name: 'what you paid?' }).click();
    await boughtRow.getByLabel(/^What you paid for Smoke Test Adventure/).fill('12.50');
    await boughtRow.getByRole('button', { name: 'Save', exact: true }).click();
    await boughtRow.getByRole('button', { name: /^paid \$12\.50$/ }).waitFor({ timeout: 10000 });
    const paidPurchase = (await (await page.request.get(`${base}/api/v1/purchases`)).json()).find((x) => x.title === 'Smoke Test Adventure');
    found = await pageProblems();
    check('ui: what you paid, asked in Store Mode right after I bought it', found.length === 0 && paidPurchase?.costCents === 1250, found.join(' | ') || JSON.stringify(paidPurchase));
    if (offlinePurchase) await page.request.delete(`${base}/api/v1/purchases/${offlinePurchase.id}`);
    // Scan my shelf: a barcode typed (a phone would scan it), matched to one of your games by a few letters, then known.
    await page.goto(`${base}/store/shelf`);
    await page.getByRole('combobox', { name: 'The console on the shelf' }).click();
    await page.getByRole('option', { name: /^PlayStation 3/ }).click();
    await page.getByLabel('Or type the barcode').fill('0 36000 29145 2');
    await page.getByRole('button', { name: 'Look', exact: true }).click();
    await page.getByText(/^Which of your games is/).waitFor({ timeout: 10000 });
    await page.getByLabel(/^A few letters of its title/).fill('unchar');
    await page.getByRole('button', { name: 'This is it' }).first().click();
    await page.getByText(/^This visit: 1 learned/).waitFor({ timeout: 10000 });
    const shelfSaved = (await (await page.request.get(`${base}/api/v1/barcodes/036000291452`)).json()).saved;
    const shelfCoverage = (await (await page.request.get(`${base}/api/v1/barcodes/coverage`)).json()).find((c) => c.key === 'playstation-3');
    // A wrong link is undone (Undo in the visit's list, or "Not this game?" on a barcode already known), then chosen again.
    await page.getByRole('button', { name: /^Undo: 036000291452/ }).click();
    await page.getByText(/^Which of your games is/).waitFor({ timeout: 10000 });
    const shelfUndone = (await (await page.request.get(`${base}/api/v1/barcodes/036000291452`)).json()).saved;
    await page.getByLabel(/^A few letters of its title/).fill('unchar');
    await page.getByRole('button', { name: 'This is it' }).first().click();
    await page.getByText(/^This visit: 1 learned/).waitFor({ timeout: 10000 });
    await page.getByLabel('Or type the barcode').fill('036000291452');
    await page.getByRole('button', { name: 'Look', exact: true }).click();
    await page.getByRole('button', { name: 'Not this game?' }).click();
    await page.getByText(/^Which of your games is/).waitFor({ timeout: 10000 });
    const shelfForgotten = (await (await page.request.get(`${base}/api/v1/barcodes/036000291452`)).json()).saved;
    found = await pageProblems();
    check(
      'ui: scan my shelf: a wrong link undone, or forgotten once known, and chosen again',
      found.length === 0 && shelfUndone === null && shelfForgotten === null,
      found.join(' | ') || JSON.stringify({ shelfUndone, shelfForgotten }),
    );
    found = await pageProblems();
    await page.request.delete(`${base}/api/v1/barcodes/036000291452`);
    check(
      'ui: scan my shelf: a barcode matched to one of your games by a few letters, then known',
      found.length === 0 && /^Uncharted/.test(shelfSaved?.title ?? '') && shelfCoverage?.withBarcode >= 1,
      found.join(' | ') || JSON.stringify({ shelfSaved, shelfCoverage }),
    );
    await page.goto(`${base}/notes`);
    await page.getByText('Look for the one with the art book').first().waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: a note shows in Store Mode and on Your notes', found.length === 0, found.join(' | '));

    // Forms as an owner uses them. A setting changed and saved on its page is kept (and set back afterwards).
    await page.goto(`${base}/settings/interface`);
    await page.getByLabel('Games the header search lists').fill('9');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText(/unsaved change/).waitFor({ state: 'detached', timeout: 10000 });
    const savedValue = (await (await page.request.get(`${base}/api/v1/settings`)).json()).values['interface.searchResults'];
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'interface.searchResults': 8 } } });
    found = await pageProblems();
    check('ui: a setting saves from its page', found.length === 0 && savedValue === 9, found.join(' | ') || `saved as ${savedValue}`);

    // A password manager filling a box (as LastPass does: a value set and an input event sent, no typing) changes
    // nothing; typing into the same box does. The server refuses a key that's an account's password either way.
    await page.goto(`${base}/settings/general`);
    const nameBox = page.getByLabel('Instance name');
    await nameBox.waitFor({ timeout: 10000 });
    const before = await nameBox.inputValue();
    await nameBox.evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Filled in by a password manager');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const autofillIgnored = (await nameBox.inputValue()) === before && (await page.getByText(/unsaved change/).count()) === 0;
    await nameBox.fill('Typed by the owner');
    const typingCounts = await page.getByText(/unsaved change/).waitFor({ timeout: 5000 }).then(() => true, () => false);
    await page.getByRole('button', { name: 'Discard' }).click();
    const passwordRefused = (await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'sources.itadKey': account.password } } })).status() === 400;
    found = await pageProblems();
    check(
      "ui: a password manager's fill changes no setting, typing does, and an account's password isn't taken as a key",
      found.length === 0 && autofillIgnored && typingCounts && passwordRefused,
      found.join(' | ') || `autofill ignored ${autofillIgnored}, typing counts ${typingCounts}, password refused ${passwordRefused}`,
    );

    // Email: your account, entered once on Settings > Email; choosing Gmail fills in its server, with the steps for an
    // app password folded under "Setting up Gmail" (a link, and a web search beside it). Notifications: another
    // service's fields show under its switch.
    await page.goto(`${base}/settings/email`);
    await page.locator('#setting-notifications\\.emailProvider input').first().click();
    await page.getByRole('option', { name: 'Gmail' }).click();
    const mailServer = await page.getByLabel('Outgoing mail server').inputValue();
    await page.getByRole('button', { name: /Setting up Gmail, step by step/ }).click();
    const appPasswords = await page.getByRole('link', { name: /Google app passwords/ }).getAttribute('href');
    const searches = await page.getByRole('link', { name: /Search the web/ }).count();
    await settle();
    const emailAccess = await seriousProblems();
    if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/settings-email.png`, fullPage: true });
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.goto(`${base}/settings/notifications`);
    await page.getByRole('switch', { name: 'Send ntfy notifications' }).click({ force: true });
    await page.getByLabel('Topic').waitFor({ timeout: 5000 });
    await settle();
    const notifyAccess = [...emailAccess, ...(await seriousProblems())];
    if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/notifications-email.png`, fullPage: true });
    await page.getByRole('button', { name: 'Discard' }).click();
    const topicGone = (await page.getByLabel('Topic').count()) === 0;
    found = await pageProblems();
    check(
      'ui: an email provider fills in its server with its app password steps, and a service shows its fields under its switch',
      found.length === 0 && mailServer === 'smtp.gmail.com' && appPasswords === 'https://myaccount.google.com/apppasswords' && searches > 0 && topicGone,
      found.join(' | ') || `server ${mailServer}, link ${appPasswords}, searches ${searches}, topic gone ${topicGone}`,
    );
    check('ui: no serious accessibility problems in the notification setup', notifyAccess.length === 0, notifyAccess.join('; '));

    // Settings > Export downloads every setting as a file, and Import takes the file back.
    await page.goto(`${base}/settings/general`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
    const settingsFile = await download.path();
    const exported = JSON.parse(readFileSync(settingsFile, 'utf8'));
    await page.locator('input[type=file][accept="application/json"]').setInputFiles(settingsFile);
    await page.locator('.mantine-Modal-content').getByRole('button', { name: /^(Import|Apply the file, keep these)$/ }).click();
    await page.getByText(/settings were applied|Settings replaced by the file/).first().waitFor({ timeout: 10000 });
    found = await pageProblems();
    // The file holds the settings changed from their defaults (never passwords or keys).
    const settingsFileOk = exported.format === 'squirrelcade-settings' && typeof exported.settings === 'object';
    check('ui: settings export to a file and import from it', found.length === 0 && settingsFileOk, found.join(' | ') || (settingsFileOk ? '' : JSON.stringify(exported).slice(0, 120)));

    // A settings file as an AI would write one: the import window lists each change and a name that isn't a setting.
    await page.goto(`${base}/settings/general`);
    const aiFile = { format: 'squirrelcade-settings', version: 1, settings: { 'features.romm': true, 'sources.rommUrl': 'http://192.0.2.20:8080', 'features.teleport': true } };
    await page.locator('input[type=file][accept="application/json"]').setInputFiles({ name: 'squirrelcade-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(aiFile)) });
    const importWindow = page.locator('.mantine-Modal-content');
    await importWindow.getByText('What the file changes:').waitFor({ timeout: 5000 });
    const importListed = await importWindow.innerText();
    const listsChanges = /Features › RomM links: Off → On/.test(importListed) && /Sources › RomM address: \(empty\) → http:\/\/192\.0\.2\.20:8080/.test(importListed) && /no setting called features\.teleport/.test(importListed);
    await page.keyboard.press('Escape');
    // Without the name that isn't a setting, it applies, and changes only its own settings.
    delete aiFile.settings['features.teleport'];
    await page.locator('input[type=file][accept="application/json"]').setInputFiles({ name: 'squirrelcade-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(aiFile)) });
    await importWindow.getByRole('button', { name: /^(Import|Apply the file, keep these)$/ }).click();
    await page.getByText(/settings were applied|Settings replaced by the file/).first().waitFor({ timeout: 10000 });
    const afterImport = (await (await page.request.get(`${base}/api/v1/settings`)).json()).values;
    found = await pageProblems();
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'features.romm': false, 'sources.rommUrl': '' } } });
    check(
      "ui: a settings file an AI wrote: the import lists each change, and applies only the file's settings",
      found.length === 0 &&
        listsChanges &&
        afterImport['features.romm'] === true &&
        afterImport['sources.rommUrl'] === 'http://192.0.2.20:8080' &&
        // Every other setting of the owner's stayed as the export before had it.
        Object.entries(exported.settings).every(([k, v]) => k in aiFile.settings || JSON.stringify(afterImport[k]) === JSON.stringify(v)),
      found.join(' | ') || importListed.slice(0, 300),
    );

    // Help > AI-assisted setup: the prompt made for this install (its summary, links to its settings, never a secret),
    // to download alone or with every guide, or to copy.
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'notifications.pushoverToken': 'walk-secret-token' } } });
    await page.goto(`${base}/help/ai-setup`);
    const [brief] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download it', exact: true }).click()]);
    const briefText = readFileSync(await brief.path(), 'utf8');
    const [fullBrief] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download it with every guide' }).click()]);
    const fullText = readFileSync(await fullBrief.path(), 'utf8');
    await page.getByRole('button', { name: 'Copy the prompt' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 5000 });
    found = await pageProblems();
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'notifications.pushoverToken': '' } } });
    const briefOk =
      briefText.startsWith('# Help me set up Squirrelcade') &&
      briefText.includes('- **Installed:** yes, version') &&
      briefText.includes(`${base}/settings/features#setting-features.steam`) &&
      !briefText.includes('<!-- squirrelcade:') &&
      !fullText.includes('walk-secret-token') &&
      fullText.includes("# Appendix: Squirrelcade's guides") &&
      fullText.length > briefText.length * 3;
    check('ui: Help > AI-assisted setup gives the prompt made for this install, to download or copy', found.length === 0 && briefOk, found.join(' | ') || briefText.slice(0, 300));

    // A Review question answered "Same game" leaves the list.
    await page.goto(`${base}/review`);
    const sameGame = page.getByRole('button', { name: 'Same game', exact: true });
    await sameGame.first().waitFor({ timeout: 10000 });
    const questions = await sameGame.count();
    await sameGame.first().click();
    await page.waitForFunction(
      (before) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Same game').length < before,
      questions,
      { timeout: 10000 },
    );
    found = await pageProblems();
    check('ui: a Review question answered on the Review page', found.length === 0, found.join(' | '));

    // A preference picked on a wishlist row is saved, shown with its mark (🔥 for the most wanted) and its acorns
    // (0.53.0: a small pill whose menu lists the levels).
    await page.goto(`${base}/wishlist`);
    const picker = page.getByLabel(/^Your preference for /).first();
    await picker.click();
    await page.getByRole('menuitem', { name: /Must Have/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label^="Your preference for "]')].some((el) => el.getAttribute('aria-label').endsWith(': Must Have') && el.textContent.includes('🔥')), null, { timeout: 10000 });
    found = await pageProblems();
    check('ui: a preference picked on the wishlist shows its mark', found.length === 0, found.join(' | '));

    // The same picker on a console's missing games (and every other list of games you don't have).
    await page.goto(`${base}/platforms/playstation-3`);
    await page.getByRole('columnheader', { name: 'Your preference' }).waitFor({ timeout: 10000 });
    const missingPicker = page.getByLabel(/^Your preference for /).first();
    await missingPicker.click();
    await page.getByRole('menuitem', { name: /Strong Interest/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label^="Your preference for "]')].some((el) => el.getAttribute('aria-label').endsWith(': Strong Interest') && el.textContent.includes('⭐')), null, { timeout: 10000 });
    found = await pageProblems();
    check("ui: a preference picked on a console's missing games", found.length === 0, found.join(' | '));

    // The game of the day, turned on: a card on the Wishlist page, and "Another one" draws again (its second pick
    // of the day, the strip says); Today shows the same card.
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'gotd.enabled': true } } });
    await page.goto(`${base}/wishlist`);
    const dayCard = page.locator('article[aria-label="Game of the day"]');
    await dayCard.waitFor({ timeout: 10000 });
    const dayBefore = await dayCard.innerText();
    await dayCard.getByRole('button', { name: 'Another one' }).click();
    const secondPick = await dayCard.getByText('Pick 2 today').waitFor({ timeout: 10000 }).then(() => true, () => false);
    found = await pageProblems();
    await page.goto(`${base}/today`);
    const onToday = await page.locator('article[aria-label="Game of the day"]').waitFor({ timeout: 10000 }).then(() => true, () => false);
    found = [...found, ...(await pageProblems())];
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'gotd.enabled': false } } });
    check(
      'ui: the game of the day shows on the Wishlist page and Today, and draws another',
      found.length === 0 && /Price on PriceCharting/.test(dayBefore) && secondPick && onToday,
      found.join(' | ') || `second pick ${secondPick}, on Today ${onToday}: ${dayBefore.slice(0, 200)}`,
    );

    // Add a game (0.60.0): typing a title on a console suggests the games you have and the catalog's; a game on a console
    // nothing was imported for (a Sega Saturn) is added by hand, the console made for it, and the collection has it.
    await page.goto(`${base}/collection/add`);
    const consoleBox = page.getByRole('combobox', { name: /^Console/ });
    await consoleBox.click();
    await consoleBox.fill('PlayStation 3');
    await page.getByRole('option', { name: 'PlayStation 3', exact: true }).click();
    await page.getByRole('combobox', { name: /^Title/ }).fill('Okam');
    const okami = page.getByRole('option', { name: /^Okami/ }).first();
    await okami.waitFor({ timeout: 10000 });
    const okamiOwned = /You have/.test(await okami.innerText());
    await page.getByRole('combobox', { name: /^Title/ }).fill('');
    await consoleBox.click();
    await consoleBox.fill('Sega Saturn');
    await page.getByRole('option', { name: 'Sega Saturn', exact: true }).click();
    await page.getByRole('combobox', { name: /^Title/ }).fill('Walkthrough Saturn Quest');
    const saysNoCatalog = await page.getByText(/Sega Saturn has no catalog yet/).isVisible();
    await page.getByLabel(/Price paid/).fill('12.50');
    await page.getByRole('button', { name: 'Add it' }).click();
    await page.getByText('Added just now').waitFor({ timeout: 10000 });
    let serious = await seriousProblems();
    const addedItem = (await (await page.request.get(`${base}/api/v1/collection/items?q=${encodeURIComponent('Walkthrough Saturn Quest')}`)).json()).items[0];
    found = await pageProblems();
    // Opened from the welcome guide, Add a game has a way back to it.
    await page.goto(`${base}/collection/add?from=welcome`);
    await page.getByRole('link', { name: 'Back to the welcome guide' }).click();
    const backOnWelcome = await page.waitForURL(/\/welcome$/, { timeout: 10000 }).then(() => true, () => false);
    check(
      'ui: Add a game suggests what you have, adds a game on a new console by hand, and leads back to the welcome guide',
      found.length === 0 && serious.length === 0 && okamiOwned && saysNoCatalog && addedItem?.platformKey === 'sega-saturn' && backOnWelcome,
      [...found, ...serious].join(' | ') || `Okami suggested as yours: ${okamiOwned}; no catalog said: ${saysNoCatalog}; back on the welcome guide: ${backOnWelcome}; added: ${JSON.stringify(addedItem ?? null).slice(0, 200)}`,
    );

    // Friends (0.56.0): a friend's file dropped on the page is brought in once you've seen whose it is, making the friend;
    // Compare lists both collections on PlayStation 3, and Trades finds Journey (marked for trade, on their wishlist) for
    // their spare Demon's Souls (on yours, as "Demons Souls"), and evens out a game picked from their collection.
    const journey = (await (await page.request.get(`${base}/api/v1/collection/items?q=Journey`)).json()).items[0];
    await page.request.put(`${base}/api/v1/copy`, { data: { key: journey.copyKey, sale: 'trade' } });
    const ps3 = (productId, title, copies) => ({ platformKey: 'playstation-3', platform: 'PlayStation 3', productId, title, copies });
    const friendFile = {
      format: 'squirrelcade-friend',
      version: 1,
      from: 'Walkthrough Friend',
      code: 'walkthrough-friend',
      madeAt: new Date().toISOString(),
      currency: 'USD',
      collection: [
        ps3('1', 'Uncharted', [{ condition: 'complete', valueCents: 1000 }]),
        ps3(null, "Demon's Souls", [{ condition: 'complete', valueCents: 2500 }, { condition: 'loose', valueCents: 1500 }]),
        ps3(null, 'Ni no Kuni: Wrath of the White Witch', [{ condition: 'loose', valueCents: 1400 }]),
      ],
      wishlist: [{ platformKey: 'playstation-3', platform: 'PlayStation 3', title: 'Journey', rank: 1, acorns: 80, priority: 'High' }],
      forTrade: [{ platformKey: 'playstation-3', platform: 'PlayStation 3', productId: null, title: "Demon's Souls", condition: 'loose', valueCents: 1500, kind: 'spare', askingCents: null }],
    };
    await page.goto(`${base}/friends`);
    await page.getByText('How it works').waitFor({ timeout: 10000 });
    await page.locator('.mantine-Dropzone-root input[type=file]').setInputFiles({ name: 'squirrelcade-2026-10-05.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(friendFile)) });
    const incomingFile = page.getByRole('dialog', { name: 'A file from Walkthrough Friend' });
    await incomingFile.getByText('3 games, 1 for trade, 1 on their wishlist').waitFor({ timeout: 10000 });
    serious = await seriousProblems();
    await incomingFile.getByRole('button', { name: 'Add Walkthrough Friend and bring it in' }).click();
    await incomingFile.waitFor({ state: 'detached', timeout: 10000 });
    const friendCard = page.locator('.mantine-Card-root', { hasText: 'Walkthrough Friend' });
    await friendCard.getByText(/Their file: 3 games, 1 for trade/).waitFor({ timeout: 10000 });
    serious = [...serious, ...(await seriousProblems())];
    found = await pageProblems();
    check("ui: a friend's file dropped on Friends is brought in, making the friend", found.length === 0 && serious.length === 0, [...found, ...serious].join(' | '));

    await friendCard.getByRole('link', { name: 'Compare' }).click();
    await page.getByRole('table').getByText('Ni no Kuni: Wrath of the White Witch').waitFor({ timeout: 10000 });
    const compared = await page.getByRole('table').innerText();
    const inMenu = (await page.locator('nav.mantine-AppShell-navbar').getByRole('link', { name: 'Walkthrough Friend' }).count()) === 1;
    serious = await seriousProblems();
    found = await pageProblems();
    check(
      "ui: a friend's page compares both collections on a console, and the menu names the friend",
      found.length === 0 && serious.length === 0 && inMenu && /Uncharted/.test(compared) && /On their wishlist #1/.test(compared) && /On your wishlist/.test(compared),
      [...found, ...serious].join(' | ') || `in the menu: ${inMenu}; ${compared.slice(0, 300)}`,
    );

    await page.getByRole('tab', { name: 'Trades' }).click();
    const idea = page.locator('.mantine-Card-root', { hasText: 'You get' }).first();
    await idea.waitFor({ timeout: 10000 });
    const ideaText = await idea.innerText();
    await page.getByPlaceholder('Find a game of theirs').fill('Ni no');
    await page.getByRole('option', { name: /Ni no Kuni/ }).click();
    const offer = page.locator('#pick-a-game .mantine-Card-root').first();
    await offer.waitFor({ timeout: 10000 });
    const offerText = await offer.innerText();
    serious = await seriousProblems();
    found = await pageProblems();
    check(
      'ui: Friends > Trades finds an even trade, and evens out a game picked',
      found.length === 0 && serious.length === 0 && /Demon's Souls/.test(ideaText) && /Journey/.test(ideaText) && /Journey/.test(offerText),
      [...found, ...serious].join(' | ') || `${ideaText.slice(0, 200)} / ${offerText.slice(0, 200)}`,
    );

    // System > Status lists what's set up, with the PC library off as on a new install (it once waited for the
    // PC library's page, which answers only while that part is on, and never showed).
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'features.pc': false } } });
    await page.goto(`${base}/system/status`);
    const setupCard = page.locator('.mantine-Card-root', { hasText: /essential steps? left|The essentials are done/ });
    const setupShown = await setupCard.waitFor({ timeout: 10000 }).then(() => true, () => false);
    const setupText = setupShown ? await setupCard.innerText() : '';
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'features.pc': true } } });
    check('ui: the setup checklist on System > Status, the PC library off', setupShown && /PC library/.test(setupText), setupText.slice(0, 200) || 'no Setup card');

    // Collection > Statistics: each platform's value over time (a table once two updates kept it, a note before).
    await page.goto(`${base}/collection/statistics`);
    const byPlatform = page.locator('.mantine-Card-root', { hasText: 'Value by platform over time' });
    const byPlatformShown = await byPlatform.waitFor({ timeout: 10000 }).then(() => true, () => false);
    found = await pageProblems();
    check('ui: value by platform over time on Statistics', byPlatformShown && found.length === 0, byPlatformShown ? found.join(' | ') : 'no card');

    // A wishlist game snoozed from its row shows as snoozed, and wakes up again.
    await page.goto(`${base}/wishlist`);
    await page.getByRole('button', { name: /^Snooze / }).first().click();
    await page.getByRole('menuitem', { name: '1 month' }).click();
    await page.getByText(/^Snoozed \(1\)$/).waitFor({ timeout: 10000 });
    await page.getByText('wake up').click();
    await page.getByText(/^Snoozed \(1\)$/).waitFor({ state: 'detached', timeout: 10000 });
    found = await pageProblems();
    check('ui: a wishlist game snoozes and wakes up', found.length === 0, found.join(' | '));

    // A PriceCharting export uploaded on the Collection updates page: the smoke test's seven games and one more.
    await page.goto(`${base}/updates`);
    const header = 'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';
    const games = ['Uncharted', 'Okami', 'Flower', 'Journey', 'Rain', 'Puppeteer', 'Tearaway', 'Ico'];
    const csv = [header, ...games.map((t, i) => `${i + 1},"${t}",Playstation 3,${1000 + i * 100},"Item, Box, and Manual",,,,500,1,2026-09-01,,,,`)].join('\n');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'collection_20260928.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByText('1 added, 0 removed').waitFor({ timeout: 20000 });
    found = await pageProblems();
    check('ui: a collection update uploads on its page', found.length === 0, found.join(' | '));

    // An export without Uncharted (one game of eight is more than an update may remove unheld, so that's raised
    // first): its copy waits on Review's Copies tab, still counted, and "I still have it" settles it.
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'collection.maxRemovalPercent': 50 } } });
    const copiesBefore = (await (await page.request.get(`${base}/api/v1/collection/summary`)).json()).totals.copies;
    const withoutFirst = [header, ...games.slice(1).map((t, i) => `${i + 2},"${t}",Playstation 3,${1100 + i * 100},"Item, Box, and Manual",,,,500,1,2026-09-01,,,,`)].join('\n');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'collection_20260929.csv', mimeType: 'text/csv', buffer: Buffer.from(withoutFirst) });
    await page.getByText('0 added, 1 removed').waitFor({ timeout: 20000 });
    await page.goto(`${base}/review?tab=copies`);
    const waiting = page.getByRole('row', { name: /Uncharted/ });
    await waiting.waitFor({ timeout: 10000 });
    const stillCounted = (await (await page.request.get(`${base}/api/v1/collection/summary`)).json()).totals.copies === copiesBefore;
    await waiting.getByRole('button', { name: 'I still have it' }).click();
    await page.getByText('No copies to ask about.').waitFor({ timeout: 10000 });
    const kept = (await (await page.request.get(`${base}/api/v1/collection/items?q=Uncharted`)).json()).items[0];
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'collection.maxRemovalPercent': 10 } } });
    found = await pageProblems();
    check('ui: a copy the next export no longer has waits on Review, and the answer settles it', found.length === 0 && stillCounted && kept?.source === 'squirrelcade', found.join(' | ') || `counted ${stillCounted}, ${JSON.stringify(kept?.source)}`);

    // A backup made on System > Backups.
    const backupCount = async () => (await (await page.request.get(`${base}/api/v1/backups`)).json()).backups.length;
    const backupsBefore = await backupCount();
    await page.goto(`${base}/system/backups`);
    await page.getByRole('button', { name: 'Back up now' }).click();
    let backupsAfter = backupsBefore;
    for (let i = 0; i < 20 && backupsAfter <= backupsBefore; i++) {
      await page.waitForTimeout(500);
      backupsAfter = await backupCount();
    }
    found = await pageProblems();
    check('ui: a backup made on the Backups page', found.length === 0 && backupsAfter > backupsBefore, found.join(' | ') || (backupsAfter > backupsBefore ? '' : `still ${backupsAfter} backups`));

    // A set made from a CSV on the Sets page opens on its own page with its games.
    await page.goto(`${base}/sets`);
    await page.getByRole('button', { name: 'New set' }).click();
    const newSet = page.locator('.mantine-Modal-content');
    await newSet.getByLabel('Name').fill('UI set');
    await newSet.getByText('From your own list (CSV)').click();
    await newSet.locator('input[type=file]').setInputFiles({ name: 'ui-set.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,Platform\nOkami,PS3\nFlower,PS3\n') });
    await newSet.getByRole('button', { name: 'Make the set' }).click();
    await page.waitForURL(/\/sets\/ui-set/, { timeout: 15000 });
    // Both games are owned: the set is complete.
    await page.getByText('2 of 2 owned').waitFor({ timeout: 10000 });
    found = await pageProblems();
    check('ui: a set made from a CSV on the Sets page', found.length === 0, found.join(' | '));

    // Collection updates from email: switched on on Settings > Email, under your account and its one test, and
    // Collection updates says what's missing (no mailbox is signed in to here).
    await page.goto(`${base}/settings/email`);
    await page.getByRole('switch', { name: 'Stash updates from your email' }).click({ force: true });
    const mailTest = await page.getByRole('button', { name: 'Save and test' }).count();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Settings saved.').first().waitFor({ timeout: 10000 });
    await page.goto(`${base}/updates`);
    await page.getByText('From your email').waitFor({ timeout: 10000 });
    await page.getByText(/Fill in your email account/).waitFor({ timeout: 10000 });
    // Wishlist > Deals is in the menu while it's on, and says where deals come from.
    await page.goto(`${base}/wishlist/deals`);
    await page.getByText(/No deals in the last 7 days/).waitFor({ timeout: 10000 });
    await page.getByRole('link', { name: 'Deals', exact: true }).waitFor({ timeout: 5000 });
    found = await pageProblems();
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'features.mail': false } } });
    check('ui: Stash updates from email are switched on on Settings > Email, and shown on Stash updates', found.length === 0 && mailTest > 0, found.join(' | ') || (mailTest > 0 ? '' : 'no Save and test button'));

    // A viewer: invited with a link, they join, look at the collection and change nothing.
    const invite = await (await page.request.post(`${base}/api/v1/invites`, { data: { name: 'Mom' } })).json();
    const viewerContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
    const viewer = await viewerContext.newPage();
    viewer.on('pageerror', (e) => !cutOff(e) && problems.push(`viewer thrown: ${e.message}`));
    await viewer.goto(`${base}${invite.path}`);
    await viewer.getByText('Welcome, Mom').waitFor({ timeout: 10000 });
    await viewer.getByLabel('Username').fill('mom');
    await viewer.getByLabel('Password', { exact: true }).fill('kitchen table');
    await viewer.getByLabel('Password again').fill('kitchen table');
    await viewer.getByRole('button', { name: 'Join' }).click();
    await viewer.locator('nav.mantine-AppShell-navbar').getByRole('link', { name: 'Today', exact: true }).waitFor({ timeout: 15000 });
    // The Stash open, so its owner-only page would show in the menu if it were offered.
    await viewer.goto(`${base}/collection`);
    await viewer.locator('nav.mantine-AppShell-navbar').getByRole('link', { name: 'Copies', exact: true }).waitFor({ timeout: 15000 });
    const viewerMenu = await viewer.locator('nav.mantine-AppShell-navbar').innerText();
    const ownerPagesShown = ['Settings', 'System', 'Review', 'Stash updates', 'Acorns ranking', 'Sales', 'Friends'].filter((l) => new RegExp(`^${l}$`, 'm').test(viewerMenu));
    await viewer.goto(`${base}/platforms/playstation-3?game=${encodeURIComponent('playstation-3|Uncharted')}`);
    const viewerDrawer = viewer.locator('.mantine-Drawer-content');
    await viewerDrawer.getByText('You own it').waitFor({ timeout: 10000 });
    const drawerButtons = [];
    for (const name of ['I bought it', 'Add to a set', 'Save note', 'Snooze']) if ((await viewerDrawer.getByRole('button', { name }).count()) > 0) drawerButtons.push(name);
    const refused = (await viewer.request.put(`${base}/api/v1/settings`, { data: { changes: { 'general.currency': 'EUR' } } })).status();
    await viewer.goto(`${base}/settings/general`);
    await viewer.getByText("This page is for the collection's owner.").waitFor({ timeout: 10000 });
    check(
      'ui: a viewer joins by link, looks, and can change nothing',
      ownerPagesShown.length === 0 && drawerButtons.length === 0 && refused === 403,
      [ownerPagesShown.length ? `menu shows ${ownerPagesShown.join(', ')}` : '', drawerButtons.length ? `drawer shows ${drawerButtons.join(', ')}` : '', refused !== 403 ? `a change answered ${refused}` : ''].filter(Boolean).join('; '),
    );
    await viewerContext.close();

    // Checking a game without signing in: on a phone, the sign-in page leads with it (when the owner turns it on).
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'security.publicCheck': 'phones', 'security.publicCheckValue': true } } });
    const phoneContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await phoneContext.newPage();
    phone.on('pageerror', (e) => !cutOff(e) && problems.push(`phone thrown: ${e.message}`));
    await phone.goto(`${base}/`);
    await phone.getByText('Shopping for them?').waitFor({ timeout: 10000 });
    await phone.getByLabel('Title or barcode to check').fill('okami');
    await phone.getByRole('button', { name: 'Check', exact: true }).click();
    await phone.getByText('They have it').first().waitFor({ timeout: 10000 });
    const answerShown = await phone.locator('body').innerText();
    // A field's text on a touch screen is at least 16px, so an iPhone doesn't zoom into it when it's tapped.
    const fieldSizes = await phone.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')].map((el) => parseFloat(getComputedStyle(el).fontSize)));
    await phoneContext.close();
    check('ui: a touch screen\'s fields are at least 16px, so an iPhone doesn\'t zoom into them', fieldSizes.length > 0 && fieldSizes.every((px) => px >= 16), JSON.stringify(fieldSizes));
    // On a computer, the ordinary sign-in.
    const desk = await (await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })).newPage();
    await desk.goto(`${base}/`);
    await desk.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 10000 });
    const deskChecks = await desk.getByText('Shopping for them?').count();
    await desk.context().close();
    await page.request.put(`${base}/api/v1/settings`, { data: { changes: { 'security.publicCheck': 'off' } } });
    found = await pageProblems();
    check(
      'ui: a phone checks a game without signing in; a computer gets the sign-in',
      found.length === 0 && /worth/.test(answerShown) && deskChecks === 0,
      found.join(' | ') || (deskChecks > 0 ? 'the computer showed the check' : /worth/.test(answerShown) ? '' : answerShown.slice(0, 200)),
    );

    // With no connection at all: once opened with one, Squirrelcade's own files stay on the device (public/sw.js), so
    // it opens offline and Store Mode answers from its copy. (The other sessions here block service workers, so
    // they can make a page's code fail to load.)
    const swContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const sw = await swContext.newPage();
    sw.on('pageerror', (e) => !cutOff(e) && problems.push(`offline thrown: ${e.message}`));
    let offlineStart = '';
    let offlineStep = 'signing in';
    try {
      await sw.goto(`${base}/`);
      await sw.getByLabel('Username', { exact: true }).fill(account.username);
      await sw.getByLabel('Password', { exact: true }).fill(account.password);
      await sw.getByRole('button', { name: 'Sign in' }).click();
      // Signed in once the header's camera button shows; the worker is registered then, and in charge of the page
      // once it's active. The next page load goes through it (it keeps the page, then the build's files).
      await sw.getByRole('link', { name: 'Store Mode: scan a game' }).waitFor({ timeout: 15000 });
      offlineStep = 'waiting for the worker';
      await sw.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });
      offlineStep = 'keeping the page';
      await sw.goto(`${base}/store`);
      await sw.waitForFunction(async () => (await caches.match('/')) !== undefined, null, { timeout: 15000, polling: 250 });
      offlineStep = "Store Mode's copy";
      await sw.getByText('Ready without a connection').waitFor({ timeout: 20000 });
      offlineStep = "the build's files";
      const offlineFiles = (await (await sw.request.get(`${base}/offline-files.json`)).json()).files.length;
      await sw.waitForFunction(
        async (count) => {
          const cache = await caches.open('squirrelcade-files');
          return (await cache.keys()).length >= count;
        },
        offlineFiles,
        { timeout: 30000, polling: 500 },
      );
      offlineStep = 'opening with no connection';
      if (webkitRun) {
        // Playwright's WebKit for Windows can't open a page from the service worker with the connection cut (it stops
        // with "internal error"); an iPhone's Safari can. What WebKit shows is that it's all ready for it.
        offlineStart = 'ready';
      } else {
        await swContext.setOffline(true);
        await sw.reload();
        await sw.getByRole('heading', { name: 'Store Mode' }).waitFor({ timeout: 15000 });
        offlineStep = 'answering with no connection';
        await sw.getByPlaceholder('Barcode or title').fill('okam');
        await sw.getByText("Squirrelcade can't be reached").waitFor({ timeout: 15000 });
        offlineStart = await sw.locator('main').innerText();
      }
      offlineStep = '';
    } catch (err) {
      if (process.env.UI_SHOTS) await sw.screenshot({ path: `${process.env.UI_SHOTS}/offline-start-failed.png` }).catch(() => undefined);
      offlineStart = `stopped at ${offlineStep}: ${String(err).split('\n')[0]}`;
    }
    await swContext.setOffline(false);
    await swContext.close();
    found = await pageProblems();
    if (webkitRun) {
      check('ui: ready to open with no connection (WebKit: the worker keeps the page, Store Mode\'s copy and every file; opening offline is checked on Chrome)', found.length === 0 && !offlineStep && offlineStart === 'ready', found.join(' | ') || offlineStart.slice(0, 300));
    } else {
      check('ui: Squirrelcade opens with no connection at all, and Store Mode answers', found.length === 0 && !offlineStep && /You own this/i.test(offlineStart), found.join(' | ') || offlineStart.slice(0, 300));
    }

    // A page whose code can't load (an update while the tab was open, then a failed reload) shows the problem
    // with the menu still there, and the next page works again.
    const failContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 }, storageState: await page.context().storageState() });
    const failing = await failContext.newPage();
    await failing.goto(`${base}/collection`);
    await failing.waitForLoadState('networkidle');
    await failing.route('**/assets/Sets-*.js', (route) => route.abort());
    await failing.locator('nav.mantine-AppShell-navbar').getByText('Almanac', { exact: true }).first().click();
    await failing.getByRole('link', { name: 'Sets' }).first().click();
    await failing.getByText("This page couldn't be shown").waitFor({ timeout: 15000 });
    const offersSupport = (await failing.getByRole('link', { name: 'Download a support file' }).count()) === 1;
    await failing.unroute('**/assets/Sets-*.js');
    // The menu's Stash (it opens its pages, Stash and Copies, like the Acorns').
    await failing.locator('nav.mantine-AppShell-navbar').getByText('Stash', { exact: true }).first().click();
    const cleared = await failing
      .getByText("This page couldn't be shown")
      .waitFor({ state: 'detached', timeout: 10000 })
      .then(() => true, () => false);
    const recovered = cleared && new URL(failing.url()).pathname === '/collection';
    const failedAt = `${failing.url()} (support file offered: ${offersSupport}, the problem cleared: ${cleared})`;
    await failContext.close();
    problems = [];
    check('ui: a page that fails shows why, offers the support file, and the menu still works', offersSupport && recovered, failedAt);

    // Home (2026-10-06): the squirrel at the top left leads to Today from any page; Statistics and Report are the
    // Almanac's; where the whole week fits (a wide screen), its arrows sit on the calendar's two sides.
    await page.setViewportSize({ width: 1680, height: 950 });
    await page.goto(`${base}/sets`);
    await page.getByRole('link', { name: /: Today$/ }).click();
    const homeIsToday = await page.waitForURL(/\/today$/, { timeout: 10000 }).then(() => true, () => false);
    const sideAfter = page.locator('.sc-week-side[aria-label="The week after"]');
    const sideShown = await sideAfter.waitFor({ timeout: 10000 }).then(() => true, () => false);
    const titleArrowsHidden = !(await page.locator('.sc-week-title-arrows').isVisible());
    if (sideShown) await sideAfter.click();
    const turned = sideShown && (await page.getByRole('heading', { name: 'Out next week' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
    await page.locator('nav.mantine-AppShell-navbar').getByText('Almanac', { exact: true }).first().click();
    const almanacStats = await page.locator('nav.mantine-AppShell-navbar').getByRole('link', { name: 'Statistics' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    found = await pageProblems();
    await page.setViewportSize({ width: 1280, height: 800 });
    check(
      "ui: the squirrel leads home to Today, a wide screen turns the week from the calendar's sides, and Statistics is in the Almanac",
      found.length === 0 && homeIsToday && sideShown && titleArrowsHidden && turned && almanacStats,
      found.join(' | ') || `home ${homeIsToday}, side arrows ${sideShown}, title arrows hidden ${titleArrowsHidden}, turned ${turned}, Statistics in the Almanac ${almanacStats}`,
    );

    // A phone's width: the menu folds away behind its button.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/wishlist`);
    await settle();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.locator('nav.mantine-AppShell-navbar').getByText('Almanac', { exact: true }).first().click();
    await page.getByRole('link', { name: 'Sets' }).first().click();
    await settle();
    found = await pageProblems();
    check("ui: a phone's menu", found.length === 0 && new URL(page.url()).pathname === '/sets', `${page.url()} ${found.join(' | ')}`);

    // At a phone's width no page scrolls sideways (wide tables scroll inside their own box).
    const wide = [];
    for (const path of paths) {
      await page.goto(`${base}${path}`);
      await settle();
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (extra > 1) wide.push(`${path} (${extra}px)`);
    }
    await page.goto(`${base}/platforms/playstation-3?tab=owned&game=${encodeURIComponent('playstation-3|Uncharted')}`);
    await drawer.getByText('You own it').waitFor({ timeout: 10000 });
    const drawerExtra = await drawer.evaluate((d) => d.scrollWidth - d.clientWidth);
    if (drawerExtra > 1) wide.push(`the game drawer (${drawerExtra}px)`);
    found = await pageProblems();
    check("ui: nothing scrolls sideways at a phone's width", wide.length === 0 && found.length === 0, [...wide, ...found].join(', '));

    // The header stays one line at a phone's width: the name gets smaller, then hides (index.html), never wraps.
    const wrapped = [];
    for (const width of [320, 375, 393, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(200);
      const below = await page.evaluate(() => {
        const bottom = document.querySelector('header').getBoundingClientRect().bottom;
        return [...document.querySelectorAll('header *')].filter((e) => {
          const box = e.getBoundingClientRect();
          return box.height > 0 && box.bottom > bottom + 1;
        }).length;
      });
      if (below > 0) wrapped.push(`${width}px (${below} parts below it)`);
    }
    check("ui: the header stays one line at a phone's width", wrapped.length === 0, wrapped.join(', '));
  } catch (err) {
    // UI_SHOTS=<folder> keeps a picture of the page where the walk-through stopped.
    if (process.env.UI_SHOTS) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${process.env.UI_SHOTS}/ui-test-stopped.png` }).catch(() => undefined);
    // The first lines of the error name the step (the locator it waited for).
    check('ui: walk-through finished', false, err instanceof Error ? err.message.split('\n').slice(0, 4).join(' | ') : String(err));
  } finally {
    await finish(browser);
  }
}
