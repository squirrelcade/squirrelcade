# Ideas from other collection apps

What other video game collection apps and services do that Squirrelcade doesn't yet, and which of it would fit. Researched 2026-09-28 at the owner's request; each idea keeps Squirrelcade's rules (every decision is a setting; anything needing an outside service is optional, with a switch).

## Looked at

| App | What it is | Stands out for |
| --- | --- | --- |
| [CLZ Games](https://clz.com/games) | Paid collection app and web | Barcode scanning with PriceCharting values, a **loan manager** (who has what, due dates), **custom fields**, **several photos per game** (2026) |
| [GAMEYE](https://www.gameye.app/) | Free collection app | Consoles, **accessories, guides and amiibo** too; **played / beaten** status; filters by missing components; price history graphs |
| [VGCollect](https://vgcollect.com/) | Collection website | A **sell list** matched against other people's wish lists (and the reverse); every variant listed; spreadsheet export |
| [PriceCharting](https://www.pricecharting.com) | Prices and collections (Squirrelcade's source) | **Wishlist alerts** when a wanted game is listed below its value on eBay or its marketplace; **lots** with PDF receipts |
| [Deku Deals](https://www.dekudeals.com/) | Nintendo, PlayStation and Xbox prices | **Price alerts** at a price you set; **collection and wishlist share links**; price history |
| [Infinite Backlog](https://infinitebacklog.net/) | Backlog and collection tracker | Imports from storefronts and RetroAchievements; **where and when you got a game**, **lending**, progress, tags |
| [VideoGameTrackarr](https://github.com/wwwescape/VideoGameTrackarr) | Self-hosted, like Squirrelcade | **Play status, playtime, sessions, ratings and reviews**; tags; IGDB search to add games by hand; **wishlist prices** from IsThereAnyDeal and PlatPrices; **public read-only share links**; CSV/JSON import and export; statistics |
| Backloggd, Grouvee, HowLongToBeat, Exophase | Play logs, shelves, time to beat, achievements | What you played and thought of it; hours to beat; trophies and achievements |

Squirrelcade already has much of what they're known for: barcode scanning (and offline), collection value and price history, completion per console, a scored wishlist, release calendar, sealed tracking, viewers and a phone check for family, and PC games from every storefront. What none of those found does: a wishlist that explains every point, catalogs built from several sources in the owner's order (physical releases first), a page of sealed games you can play another way, and links to a RomM.

## Worth adding, most useful first

**0.6.0 (2026-09-28) added 1 to 9**, as the owner asked, with these limits: the spreadsheet import (3) reads a CSV, and adding games in Squirrelcade itself came later (0.20.0, D83); the sell list (6) is a list with a share link, with no matching against other people's wish lists; statistics (7) charted value by console over time only from 0.13.0 (Collection > Statistics, D75); photos (8) are kept in the database (so backups have them) rather than the config folder; the report (9) gives each copy's photo count, not the photos. See D52 to D59.

1. **Play status and a backlog** (VideoGameTrackarr, GAMEYE, Backloggd): unplayed, playing, beaten, completed, dropped, with a rating and notes; filters for "never played" and a "what to play next" pick among games you own. Nothing outside Squirrelcade needed. Pairs with Copies (a sealed game you've beaten on PC) and the Top 100 ("beaten 40 of the 100").
2. **A share link for the wishlist** (Deku Deals, VideoGameTrackarr): a read-only page anyone with the link can open, for birthdays and holidays, with the wishlist's top picks and what you already have. Smaller than a viewer account; same privacy rules (no prices paid, no notes unless shared); the owner can withdraw it.
3. **Other ways in besides PriceCharting** (the owner's roadmap): a spreadsheet import (title, console, condition, price paid, date) so people using CLZ, GAMEYE, VGCollect or their own spreadsheet can start; later, adding and editing games in Squirrelcade itself (IGDB search, or a barcode), which makes PriceCharting optional.
4. **Loans, location and tags per copy** (CLZ, Infinite Backlog, Koillection): who borrowed a game and when it's due, where it's kept (shelf, box), and tags of your own. Kept in Squirrelcade beside PriceCharting's data, like notes.
5. **Prices for the PC wishlist** (VideoGameTrackarr): IsThereAnyDeal has a free API key and waitlist alerts; an optional part that shows each PC wishlist game's best current price and historical low, and sends a message when one drops below a price you set.
6. **A sell and trade list** (VGCollect): from Copies' "more than one copy", mark copies for sale or trade, download or share the list. Matching with other people's wish lists would need a service, so it stays a list.
7. **Statistics** (GAMEYE, Infinite Backlog, VideoGameTrackarr): charts of the collection by console, genre, decade and condition, what you added each year, and value by console over time. Squirrelcade has the data; it needs a page.
8. **Photos of your copies** (CLZ): a few pictures per copy, for condition and insurance, kept in the config folder and in backups.
9. **An insurance or sale report** (PriceCharting's lots): a printable page or PDF of the collection (or a chosen part) with values and photos.

## Planned, not built yet

- **Shelf Scan**, built 2026-10-11 as **Check a shelf** (D147; still to come: tap a box to fix it, fixes remembered, the full known list of a console's games) (the owner's idea, 2026-10-10; [design](design/shelf-scan.md)): a photo of a store shelf in, a checklist out (have it, have it on another console, on the wishlist, missing, unsure). Reading the spines on the phone against the console's own list of games (no AI, no signal needed), the title matcher Claude's connector already uses deciding ownership, and a vision model of the owner's choosing (any service, or one at home) only for the spines left unsure, if turned on: nothing tied to one AI company. Measured 2026-10-10 on real shelf photos: the on-phone reader finds a third to half of a shelf, never wrong.

- **History: every game as it was seen then, and as it's seen now** (the owner's next step, 2026-10-23; [design](design/history.md)): two views in every game's drawer. **At the time**: the magazines of its months (opened at the page in the owner's scans), the review scores of the day from Wikipedia's review tables with their issues and pages, the web as it was (the Wayback Machine), the video reviews and commercials of its era. **Looking back**: retrospectives and documentaries from video channels the owner picks (played inside Squirrelcade, full screen), essays, and the game's page on reference sites (from Wikidata). A History section with a Time machine (a month at a time) and the Timeline. Five phases, the game's identity and Reviews from the time first.
- **Start collecting a followed console** (from D169's plan, 2026-10-24): a button on a followed console's Roots page that makes it a collected console at once, with a checklist; most followed consoles have no Wikipedia list set up as a catalog source yet (the Vectrex, the Astrocade...), so each needs one first. Until then, owning a few different games of it makes it collected.
- **More on Roots' console cards** (the owner, 2026-10-23: "I also kind of feel like in there that there might need to be more information, but we might be adding that later"): each card in Roots > Consoles shows only its name, launch year and links; it could carry the maker, years on sale, units sold, how many of its Top 100 you have, a picture of the console.
- **Series in the Nutshell** (the owner's idea, 2026-10-23): beside Platforms, a series' games with each game counted once wherever you have it ("as long as we have one copy somewhere, it counts for that game"), PC apart, like Big Box's series view; Sets > Series today counts each console's version apart. Built 2026-10-23 (D166) as Nutshell > Series.
- **Old computers: the Apple II first, then the Commodore 64 and others** (the owner, 2026-10-23; [history-build.md](design/history-build.md#later)): platforms beside the consoles, collected like them (boxed disks, manuals, feelies), with their magazines (Softalk, Nibble, inCider, Compute!...) in Leaves. Later, after the History phases.
- **Regular public releases** (every couple of weeks, so other installs stay close to the owner's) and **a What's new note on Today** after each update (the owner's yes, 2026-10-23).
- **PC in the Stash and Acorns** (the owner's idea, 2026-10-23; [history-build.md](design/history-build.md#pc-games)): the PC library under the Stash, PC wishlist and PC deals under Acorns, totals side by side; with History, PC games get the same game page as console games (their storefronts, hours and achievements as Your copies).
- **Magazines** (the owner's idea, 2026-10-21; [design](design/magazines.md)): a library of the owner's scanned game magazines (Nintendo Power, EGM, GamePro...), the scans left on the NAS: issues and physical copies tracked, read page by page on a phone (a reader built into Squirrelcade from open-source parts; Komga or Kavita only as optional links), their text read at home (the scan's own text layer, else OCR on the server's processor) and searchable across every issue, the games on a page tappable while reading (each outlined where it's printed, a tap showing whether you have it, where it's kept, where it is in RomM, and its details), and the games they cover linked both ways: **In the magazines** on a game's page (issue, page, review score, opening at the page), the games on an issue's page, a Review queue for the uncertain ones. Three phases: the library and reading; text and search; the games.
- **One haul flow** (logged 2026-10-21 at the owner's ask, from Claude's suggestion; not designed yet): after a pile of games is scanned in with **Add it**, Squirrelcade looks up all their prices in the owner's order emails at once (Find in my email, D155, for every copy just added, without asking for each), and lines what it found up in **Stash > Recently added** to confirm in a tap per copy, beside the condition, the rip and the place. One sitting: scan the pile, confirm the prices, rip, put away. Builds on Add it (D153), Look up prices in my email (D155) and Recently added (D161); off unless Find in my email is on.

## Not recommended now

- **Time to beat** (HowLongToBeat): no official API; the community libraries scrape the site, which breaks and may break its terms.
- **Price alerts for console games:** there's still no free source of prices for games you don't own (PriceCharting's alerts need its own wishlist; its API is paid).
- **Amiibo, consoles and accessories as their own lists** (GAMEYE): PriceCharting's export already carries them; worth a look only if owners ask.

**0.15.0 (2026-09-29):** exports from CLZ Games, GAMEYE and VGCollect go in as they come (D77), with CLZ's barcodes.

**0.17.0 (2026-09-29):** the upgrade list (Collection > Upgrades, D79).

**0.18.0 (2026-09-29):** RetroAchievements (D80): your progress in each game's drawer, and optionally in What you played.

**2026-09-29 to 30:** adding games in Squirrelcade, sent to PriceCharting through its paste importer (0.20.0), then the owner's ideas below. PriceCharting's API (Legendary plan only) isn't planned. **2026-09-30:** AI-assisted setup (0.29.0, D93), the owner's idea: a prompt for the owner's own AI, made for their install.

**The owner's ideas (2026-09-29), with Squirrelcade as the hub of the collection** (built from 0.19.0 to 0.28.0, but CLZ Games; [design](design/adding-games.md)):

- **Squirrelcade as the master copy** (built, 0.19.0 and 0.20.0, D81 to D83): every physical copy its own record, entered here or brought by an import; PriceCharting becomes a price source and one more copy of the list.
- **Tested** (built, 0.21.0): a button on a copy that records when it was tested, whether it works, and a note, with the history kept.
- **Standard photos** (built, 0.21.0) of each copy: box front, back and spine, the disc or cartridge front and back, the manual (the slots a setting). Photos of copies exist since 0.6.0 (up to 10 a copy); slots are new.
- **Achievements beyond RetroAchievements** (built for Xbox and PlayStation, 0.24.0, D88; Steam, 0.28.0, D92): Steam through its official Web API (a free key); Xbox through OpenXBL, a third-party API (a free key, 150 requests an hour); PlayStation has no official API: community libraries use a token copied from the browser after signing in to PlayStation's site, which lasts about two months and may break.
- **The collection on several services**, as extra copies of the list (PriceCharting's side built, 0.20.0, D83; CLZ Games on hold, since the owner doesn't use it); the full backup stays Squirrelcade's own (the database with photos, copied to a second folder and from there off site).
- **Estimated prices** (built, 0.21.0; the owner's own, with a Suggest button, D85): for copies without a price paid (a sealed copy bought new at launch), an estimate from the console's usual price for a new game that year and the game's release date, marked as an estimate everywhere.
- **Improve your collection** (built, 0.21.0): a list of what's missing (price paid, date, photos, a test, where it's kept), filled in one copy at a time.
- **A selling helper** (built, 0.22.0, D86; the owner's plan to play a game, then sell it for a lunch): "ready to sell" on a copy the owner picks or Squirrelcade suggests (games finished, extra copies), an eBay and a Mercari helper that write the listing (title, description with the test, item specifics) and value the game (after fees and shipping, with sold listings), the photos to take (front, back, inside, disc front and back), a Ripped record for PS3 and Xbox 360 games read in full, and each sale counted in meals.
