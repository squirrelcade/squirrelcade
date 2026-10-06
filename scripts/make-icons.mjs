// Draws Squirrelcade's logo files into docs/brand from one 16 x 16 grid, the pixel squirrel of the October 2026 brand kit
// (D116: the squirrel holding its acorn, in the kit's browns, the app icon on deep green; the acorn green with a dark
// brown cap, as the first logo had it, D140): two
// SVGs, PNGs at the sizes browsers, phones, GitHub and Pushover use (each at a whole number of screen pixels per squirrel
// pixel, so it stays crisp), and the wordmark for light and for dark backgrounds. Then copies the app's own into
// apps/web: the browser tab's and the home screens' icons (public), and the squirrel its pages show (src).
// Usage: node scripts/make-icons.mjs (Chrome, or Edge with UI_BROWSER=msedge)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// T tail, t the tail's light side, B body, b belly, k eye, C acorn cap, N acorn.
const GRID = [
  '................',
  '................',
  '...TTT..........',
  '..TtttT.....B...',
  '.TtT.TT....BB...',
  '.TT..Tt...BBBB..',
  '.TT..Tt..BBBkBB.',
  '.....Tt..BBBBB..',
  '.....TTTBBbB....',
  '......TTBbbCCC..',
  '......TTBbNNNN..',
  '......TTBbbNN...',
  '.......TBbbB....',
  '.......BBBBBB...',
  '......BB...BB...',
  '................',
];
const COLORS = { T: '#c27a3f', t: '#e3a866', B: '#8e5428', b: '#e9cfa6', k: '#111111', C: '#6b3a10', N: '#46a36b' };
/** The app icon's background: the kit's deep green. */
const FOREST = '#16392a';

/** The squirrel as SVG: `cell` units per pixel, `pad` units around it, an optional background. */
function svg(cell = 1, pad = 0, bg = null) {
  const size = 16 * cell + 2 * pad;
  const d = {};
  GRID.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (COLORS[ch]) d[ch] = (d[ch] || '') + `M${pad + x * cell} ${pad + y * cell}h${cell}v${cell}h-${cell}z`;
    }),
  );
  const back = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  const paths = Object.entries(d)
    .map(([ch, p]) => `<path d="${p}" fill="${COLORS[ch]}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">${back}${paths}</svg>`;
}

const out = 'docs/brand';
mkdirSync(out, { recursive: true });
// Vector files: the bare squirrel (a browser tab, a page header), and the app icon on deep forest green.
writeFileSync(`${out}/squirrelcade.svg`, svg(1, 0) + '\n');
writeFileSync(`${out}/icon.svg`, svg(1, 2, FOREST) + '\n');

// PNGs: [file, screen pixels per squirrel pixel, padding in screen pixels, background].
const pngs = [
  ['favicon-16.png', 1, 0, null],
  ['favicon-32.png', 2, 0, null],
  ['icon-192.png', 9, 24, FOREST],
  ['icon-512.png', 24, 64, FOREST],
  ['icon-maskable-512.png', 18, 112, FOREST],
  ['apple-touch-icon.png', 9, 18, FOREST],
  ['pushover-128.png', 7, 8, null],
  ['avatar-500.png', 20, 90, FOREST],
];

// The wordmark: the squirrel beside "squirrelcade" in Fredoka Bold, from the web app's own copy of the font.
const font = readFileSync(new URL('../node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2', import.meta.url)).toString('base64');
const wordmark = (squirrel, cade) => `<style>@font-face { font-family: Fredoka; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }</style>
  <div id="w" style="display:inline-flex;align-items:center;gap:22px;padding:16px 24px 16px 16px">${svg(6, 0)}<span style="font:700 92px Fredoka;letter-spacing:-1.5px;line-height:1"><span style="color:${squirrel}">squirrel</span><span style="color:${cade}">cade</span></span></div>`;

const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, cell, pad, bg] of pngs) {
    const size = 16 * cell + 2 * pad;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(cell, pad, bg)}</body></html>`);
    await page.locator('svg').screenshot({ path: `${out}/${file}`, omitBackground: true });
  }
  await page.setViewportSize({ width: 1200, height: 300 });
  for (const [file, squirrel, cade] of [
    ['wordmark.png', '#a8632d', '#1e7546'],
    ['wordmark-dark.png', '#c0763a', '#3dbe74'],
  ]) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${wordmark(squirrel, cade)}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#w').screenshot({ path: `${out}/${file}`, omitBackground: true });
  }
} finally {
  await browser.close();
}

// The app's copies.
for (const file of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) copyFileSync(`${out}/${file}`, `apps/web/public/${file}`);
copyFileSync(`${out}/squirrelcade.svg`, 'apps/web/public/favicon.svg');
copyFileSync(`${out}/squirrelcade.svg`, 'apps/web/src/squirrel.svg');
// The AI apps' sign-in page stands alone (none of the website's files), so it carries the squirrel itself.
writeFileSync(
  'apps/server/src/squirrelLogo.ts',
  `/** The squirrel (docs/brand/squirrelcade.svg), written by scripts/make-icons.mjs, for the AI apps' sign-in page. */\nexport const SQUIRREL_SVG = ${JSON.stringify(readFileSync(`${out}/squirrelcade.svg`, 'utf8').trim())};\n`,
);
console.log(readdirSync(out).join(' '));
