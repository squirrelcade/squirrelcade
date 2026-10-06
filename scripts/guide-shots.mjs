// Screenshots for the install and setup guide (docs/guide/img): the first page, each step of the welcome guide, the
// setup checklist and the pages the guide sends people to, from a FRESH install with a made-up collection
// (demo-data.mjs). Never run it against a real install: it creates the first account.
//   node scripts/guide-shots.mjs http://127.0.0.1:7578 [output folder, docs/guide/img by default]
// It needs the internet (Wikipedia's game lists build the catalogs). Chrome, or Edge with UI_BROWSER=msedge.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { exportCsv } from './demo-data.mjs';

const target = (process.argv[2] ?? 'http://127.0.0.1:7578').replace(/\/+$/, '');
const out = process.argv[3] ?? 'docs/guide/img';
mkdirSync(out, { recursive: true });

const session = await (await fetch(`${target}/api/v1/auth/session`)).json();
if (!session.setupRequired) throw new Error('This install is set up already: the guide shots run only on a fresh one.');

const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
const page = await context.newPage();
const shots = [];

/** A JPEG of the page (or one element of it) in the output folder, without the pop-up notifications over it. */
async function snap(name, of = page) {
  await page.addStyleTag({ content: '[class*="Notifications-root"] { display: none !important; }' });
  await page.waitForTimeout(700);
  const file = `${out}/${name}.jpg`;
  await of.screenshot({ path: file, type: 'jpeg', quality: 80 });
  shots.push(file);
}

/** The API, signed in as the browser is (its session cookie). */
const api = (method, path, data) => page.request.fetch(`${target}/api/v1${path}`, { method, ...(data === undefined ? {} : { data }) });

try {
  // 1. The first page: the owner's account, then the basics.
  await page.goto(target);
  const password = `guide-only-${Math.random().toString(36).slice(2)}`;
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password again').fill(password);
  const card = page.locator('.mantine-Paper-root').first();
  await snap('setup', card);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create account and start' }).waitFor();
  await snap('setup-basics', card);
  await page.getByRole('button', { name: 'Create account and start' }).click();

  // 2. The welcome guide: the collection (the made-up export, dropped in as PriceCharting names it).
  await page.getByText('Drop your export or spreadsheet here').waitFor({ timeout: 20000 });
  await api('PUT', '/settings', { changes: { 'interface.theme': 'dark', 'gotd.enabled': true } });
  await page.locator('input[type=file]').first().setInputFiles({ name: 'collection_20260927.csv', mimeType: 'text/csv', buffer: Buffer.from(exportCsv()) });
  await page.getByText(/games on \d+ consoles/).waitFor({ timeout: 30000 });
  await snap('welcome-collection');

  // Consoles, then catalogs once they're built (Wikipedia, read slowly: a few minutes).
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Consoles', { exact: false }).first().waitFor();
  await snap('welcome-consoles');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText(/catalogs? (are )?built/).waitFor({ timeout: 30000 });
  const rest = page.getByRole('button', { name: 'Build the rest now' });
  if (await rest.isVisible().catch(() => false)) await rest.click();
  await page.getByText(/^All \d+ catalogs are built/).waitFor({ timeout: 10 * 60_000 });
  await snap('welcome-catalogs');

  // Covers (IGDB): skipped here, as a tester without keys would.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).waitFor();
  await snap('welcome-covers');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForTimeout(1500);
  await snap('welcome-wishlist');

  // 3. The setup checklist, on System > Status.
  await page.goto(`${target}/system/status`);
  const checklist = page.locator('.mantine-Card-root', { hasText: /essential steps? left|The essentials are done/ });
  await checklist.waitFor({ timeout: 20000 });
  await snap('status-setup', checklist);

  // 4. Exports by email (Settings > Features), turned on to show its fields and steps.
  await api('PUT', '/settings', { changes: { 'features.mail': true } });
  await page.goto(`${target}/settings/features`);
  const mail = page.getByText('Stash updates from your email', { exact: true }).first();
  await mail.waitFor({ timeout: 20000 });
  // Its switch at the top, below the header.
  await mail.evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -90);
  });
  await snap('features-mail');
  await api('PUT', '/settings', { changes: { 'features.mail': false } });

  // 5. Notifications: Pushover's card, turned on to show its fields and steps.
  await api('PUT', '/settings', { changes: { 'notifications.pushoverEnabled': true } });
  await page.goto(`${target}/settings/notifications`);
  const pushover = page.locator('.mantine-Card-root').filter({ has: page.getByRole('heading', { name: 'Pushover', exact: true }) });
  await pushover.waitFor({ timeout: 20000 });
  await pushover.scrollIntoViewIfNeeded();
  await snap('notify-pushover', pushover);
  await api('PUT', '/settings', { changes: { 'notifications.pushoverEnabled': false } });

  // 6. Store Mode on a phone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const p = await phone.newPage();
  await p.goto(`${target}/store`);
  await p.getByPlaceholder('Barcode or title').fill('zelda');
  await p.waitForTimeout(2500);
  const file = `${out}/store-phone.jpg`;
  await p.screenshot({ path: file, type: 'jpeg', quality: 75 });
  shots.push(file);
  await phone.close();
} finally {
  await browser.close();
}
console.log(`${shots.length} screenshots in ${out}:\n${shots.join('\n')}`);
