# Squirrelcade Deal check (browser extension)

Press the button on a store's page and each game listed gets a badge: the Stash's chest (filled: you have it on that console; grey: you don't), a dot for how sure that is (green, yellow, red), its acorns when it's on your wishlist, and a PriceCharting button with loose, complete and new prices. **Copy for Claude** copies the page's games as a table to paste into a chat. How it works and what each part means: [Deal check in Help](../docs/help/wishlist.md#deal-check-the-browser-extension).

It works in Edge, Chrome and the other Chromium browsers. Nothing runs until you press the button, and only on that page.

## Install

1. Open the browser's extensions page (`edge://extensions` or `chrome://extensions`) and turn on **Developer mode**.
2. Build the game drawer once (and after each update): `npm run build:extension --workspace @squirrelcade/web` from the repository's root. It puts Squirrelcade's drawer in `extension/drawer/`.
3. **Load unpacked**, and pick this `extension` folder.
4. Pin the Squirrelcade button to the toolbar (the puzzle-piece menu).
5. The options page opens on the first press: enter the address you open Squirrelcade at (for example `http://192.168.1.20:7575`) and its API key (Squirrelcade: Settings > Security). The browser asks once to let the extension reach that address.

To update it after pulling new code, press the reload arrow on the extension's card on the extensions page.

## Files

- `manifest.json`: Manifest V3. Permissions: `activeTab` and `scripting` (the page you press the button on, only then), `storage` (your address and key, in this browser only), PriceCharting's site, and your Squirrelcade's address (asked for when you save it).
- `background.js`: the button, the call to `POST /api/v1/deal-check` with your key, and reading PriceCharting's prices.
- `content.js`: put on the page by the button: reads the listings (Amazon, Walmart, or the selected lines) and draws the badges and the bar.
- `options.html`, `options.js`: your Squirrelcade's address and API key.
- `drawer/` (built, not in git): Squirrelcade's game drawer from `apps/web/src/embed/drawer.tsx`, shown in a frame over the store's page. It asks Squirrelcade through `background.js` (a store's https page can't show Squirrelcade's http address).

The chest and the acorn are drawn exactly as `apps/web/src/Acorn.tsx` draws them; keep them the same.
