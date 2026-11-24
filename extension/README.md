# Squirrelcade Deal check (browser extension)

On a store's page each game listed gets a badge: the Stash's chest (filled: you have it on that console; soft red: it's on its way to you; half filled: you have it on another console; grey: you don't) with the marks of every console it came out on, your acorns (a button to set your preference), its flags, PriceCharting's prices with a deal meter, and H, M or L for how sure the answer is. The chest opens Squirrelcade's own game drawer over the page. Its toolbar button shows how many games it found; its window has the counts, **Check again**, **Copy for Claude** (the page's games as a table to paste into a chat) and the store's **Auto** switch. How it works and what each part means: [Deal check in Help](../docs/help/wishlist.md#deal-check-the-browser-extension).

It works in Edge, Chrome and the other Chromium browsers. On the stores it reads (below) it runs by itself as a page loads (each store's **Auto** switch in the window turns that off); anywhere else, use the window's **Check this page** on the titles you've selected. It reads only that page.

## Install

1. Open the browser's extensions page (`edge://extensions` or `chrome://extensions`) and turn on **Developer mode**.
2. Build the game drawer once (and after each update of the web app): `npm run build:extension --workspace @squirrelcade/web` from the repository's root. It puts Squirrelcade's drawer in `extension/drawer/`.
3. **Load unpacked**, and pick this `extension` folder.
4. Pin the Squirrelcade button to the toolbar (the puzzle-piece menu).
5. The options page opens on the first press: enter the address you open Squirrelcade at (for example `http://192.168.1.20:7575`) and its API key (Squirrelcade: Settings > Security). The browser asks once to let the extension reach that address.

**Updates:** the extension updates itself. Every 10 minutes (and when the browser starts) it reads the `manifest.json` in its folder, and when the version there differs from the one running, it reloads, and its window says "Deal check updated itself to ..." the next time it opens. So after pulling new code (or a change made here), nothing needs pressing. A change that should reach the browsers needs a new `version` in `manifest.json`.

## Stores

- **Readers of their own** (`READERS` in `content.js`): Amazon (results, featured grids, a product's page, the format line such as "Digital Code in Box"), Walmart, Video Games Plus (prices in CAD, converted for the deal meter at the day's ECB rate from api.frankfurter.dev), eBay, Mercari, GameStop, Target, Best Buy, GameFly, Nintendo eShop.
- **The general reader** (`GENERAL_SHOPS`): Limited Run Games, Super Rare Games, Fangamer, Woot, Play-Asia, eStarland, DKOldies, PNP Games, Square Enix Store, Deku Deals, PlayStation Store, Xbox and Microsoft Store, Kinguin, Outpost Gaming. It finds a page's repeated product cards (an element with a link, a picture and a price; or, without prices, the product links), takes each card's title, price and console, and on a product's own page reads its schema.org data.
- Each store's address must also be in `manifest.json`'s `content_scripts.matches` for it to run by itself.

Store pages change. **Ticky T-592** checks every reader monthly: `node .work/deal-check/reader-check.mjs` (headless Edge, no server needed) lists what each reader finds; stores that turn a headless browser away are checked in a real browser instead (never by disguising the test browser).

## Files

- `manifest.json`: Manifest V3. Permissions: `activeTab` and `scripting` (the page you press the button on), `storage` (your address and key, in this browser only), `alarms` (the update check), PriceCharting and the exchange-rate service, and your Squirrelcade's address (asked for when you save it). `content_scripts` puts `content.js` on the stores it reads.
- `background.js`: the button, the update check, the calls to Squirrelcade with your key (`POST /api/v1/deal-check`, the drawer's API calls and pictures), PriceCharting's prices and the exchange rate.
- `popup.html`, `popup.js`: the toolbar button's window (counts, Check again, Copy for Claude, Auto), talking to the page's `content.js`.
- `content.js`: reads the listings and draws the badges and their windows (PriceCharting, acorns, H/M/L); `window.__squirrelcadeDeal.peek()` lists what the page's reader finds without asking Squirrelcade.
- `options.html`, `options.js`: your Squirrelcade's address and API key.
- `drawer/` (built, not in git): Squirrelcade's game drawer from `apps/web/src/embed/drawer.tsx`, shown in a frame over the store's page. It asks Squirrelcade through `background.js` (a store's https page can't show Squirrelcade's http address); its pictures come the same way, videos open on YouTube and Squirrelcade's pages open at home in a new tab.

The chest and the acorn are drawn exactly as `apps/web/src/Acorn.tsx` draws them (plus the extension's half and soft red chests); the console marks come from the server (`markSvg`), never drawn here.
