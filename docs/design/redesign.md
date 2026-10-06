# The October 2026 redesign (from the owner's Claude Design mockups)

The owner made five mockups with Claude Design on 2026-10-05 (the zip `squirrelcade-mockups.zip`, kept outside the repo):
a brand kit, Today, a console page, a game page (phone) and Store Mode (phone). They asked for a review and for as much of
it as possible to be built. This is the review and the plan; the changelog says how far it got.

## The design, in short

- **Ground:** charcoal neutrals instead of the green-tinted dark: chrome `#111111` (header and menu), ground `#161616`
  (page), surface `#1D1D1D` (cards), raised `#262626`, borders `#2C2C2C` and `#383838`, text `#F2EFEA`, muted `#9E988F`,
  faint `#6F6A63`.
- **Brand:** squirrel `#C0763A`, tail light `#E3A866`, cade green `#3DBE74` (the accent: active menu item, primary buttons
  with dark text `#0F1F16`, progress, "go"), deep green `#16392A` (secondary buttons, highlighted panels, border `#22553B`),
  mint `#A3EDC2` (text on green), acorn gold `#E9B44C` (wanted, missing, needs a check; panels `#2A2312`, border `#5A4A26`).
  Down/over market: `#3A1F17` with `#F2A285`.
- **Platform colors** (colorblind-checked): PlayStation `#3987E5`, Xbox `#199E70`, Nintendo `#D95926`, other `#C98500`.
- **Type:** Fredoka 600 to 700 for headings and the wordmark; the system font for reading; **Silkscreen** (a pixel face)
  only for labels, scores and big numbers.
- **Voice:** numbers first ("$4.20 below market"), plain words; green means yours and go, gold means wanted, missing or
  check.
- **Pieces:** buttons 44 to 46 px tall, radius 10; status tags in capitals (HAVE IT, WISHLIST #1, MISSING dashed, SCORE 78);
  a score ring; a price-against-market bar; Store Mode's verdict banner.

## Review

What works: one clear identity (brown squirrel, arcade green, charcoal), pixel type used sparingly, numbers first, and a
Today page that answers "what matters today" with real actions (answer a question there, see a deal against market).
Platform colors help scanning. Most of it maps onto data Squirrelcade already has.

What to adjust, and why:

1. **The name.** The mockups' titles say "SquirrelCade"; the app, site and docs say "Squirrelcade" (D99), and the wordmark
   is lowercase in both. Kept as "Squirrelcade" unless the owner wants the capital C.
2. **Light mode.** The kit is dark only; the app has light, dark and the system's choice. Dark follows the kit exactly;
   light gets the same brand colors on light neutrals.
3. **Contrast.** Faint text `#6F6A63` on `#161616` is about 3.4:1, under the 4.5:1 the walkthrough's accessibility check
   asks for running text: faint is kept for decoration and empty states, muted `#9E988F` (6.9:1) for words.
4. **Store Mode's verdict needs a market price for games you don't own** (the mockup: "$18.18 CIB, $12.19 loose" for a
   wishlist game). Squirrelcade has no price source for those (D01: no paid PriceCharting plan). The verdict uses a price
   when one is known (a copy of yours of the same item, or a PriceCharting deal email for it) and otherwise says what it
   can: wishlist rank, missing, have it, check the manual.
5. **The console page's photo** has no data source; it's left out. (The review first said the history figures had none
   either: they do, in the console history (D49), and the page uses them.)
6. **Game of the Day "pick 2 of 3" and "Another one"** need the server to offer the day's next picks (today it gives
   one, D71): a small addition.
7. **Phones:** the game page and Store Mode are drawn for phones with a bottom bar (Today, Collection, Store Mode,
   Wishlist, More). The bottom bar is a navigation change for every page; it comes last.

## Plan

1. **0.47.0, the look:** the kit's tokens in the Mantine theme (both color schemes), Silkscreen self-hosted (as Fredoka
   is), the header and menu as the kit's chrome, buttons, status tags, platform colors.
2. **0.48.0, Today:** the mockup's page with real data: greeting and chips; Game of the Day card (score ring, its biggest
   points, shop buttons); this week in game history; out this week as a seven-day strip; deals with the price bar; a
   Review question answered in place; the last update; the collection's pulse (copies, goal, copies added each year, by
   platform); biggest movers; completion.
3. **0.49.0, a console's page:** the head block (completion bar in three parts, count tiles, value and its change), the
   Top 100 as a ten-by-ten board with the hunting list.
4. **0.50.0, Store Mode and the game drawer:** the verdict banner (with the limits in 4), status tags in the drawer
   (HAVE IT ×2, TOP 100 · #1), a duplicate's "List one for sale".
5. **Later:** the phone's bottom bar.

Each step is a release with its own rollback point; the decisions record has the details.

## Progress

- 0.47.0, the look: done (D116).
- 0.48.0, Today: done (D117). Differences from the mockup: no "of 3" on the game of the day's pick (no daily cap), "Everything else" counts the game's other reasons before the score is fitted to the scale, and the select in its footer is the wishlist preference that was already there (the mockup's platform list has no data behind it).
- 0.49.0, a console's page: done (D118). The history data turned out to have most of the mockup's figures (units sold, launch prices, competitors, hardware), so the head line and the History tiles use them; the console photo and the hunting list's Watch button aren't built.
- 0.50.0, Store Mode and the drawer: done (D119). The verdict uses the answers Squirrelcade has; the sticker-price verdicts need a market value for games you don't own, which there isn't (D01).
- 0.51.0, the phone's bottom bar: done (D120).
- squirrelcade.com in the new look: prepared (the site's colors, the new squirrel, screenshots of Today, Store Mode, a console's Top 100 and the collection), published with the owner's go-ahead.
