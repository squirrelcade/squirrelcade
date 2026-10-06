# Changelog

What changed in each version of Squirrelcade (called Gamefolio before 0.35.0). The decisions behind these (D01, D02...) are in [docs/DECISIONS.md](docs/DECISIONS.md), each with a tag to roll it back.

## 1.1.0 (coming): the Stash's chest

### Added

- **The Stash's chest** (D142): a pixel treasure chest for what you have, as the acorn is for what you want. It's the Stash's mark in the menu (in the gamepad's place) and on the phone's tab bar, after the Stash page's title, and before whatever says you have a game: "Have it" on Today and in the game drawer, "You own it" and "Owned" in Coming soon, Past releases, Series, Deals, Check a list and the page friends check, the Owned tile and tab of a console and of a set, Store Mode's "You own this", and each side's copies when you compare with a friend. The Acorns wishlist's title has its acorn.

## 1.0.0 (2026-10-06): the first public release

Squirrelcade's code is public on GitHub, free under the AGPL-3.0 license, and its image can be pulled by anyone. PriceCharting supports the way Squirrelcade uses its values (each person's own export, credited and linked). The versions below are how it got here.

### Changed

- **Two labels for the image** (D141): `latest` moves only with a release; `edge` gets each change as soon as it passes its tests, for an install that wants it first. A release is also tagged with its version (`1.0.0`, `1.0`). See [Keep it running](docs/guide/maintain.md).
- **PriceCharting credited wherever its values show:** "Values from PriceCharting", linked to its site, at the bottom of the menu on every page and under the Stash's value (PriceCharting's one condition, 2026-10-06), and on squirrelcade.com.

## 0.60.1 (2026-10-06): deals without the manuals, and the green acorn

### Changed

- **Deals leave out a manual, a case or a box listed alone** ("Manual Only", "Case Only", "No Game"; a reproduction or a strategy guide too), judged by the listing's own title: PriceCharting's deal emails compare such a listing with a whole game's market value, so it looked like a bargain. A disc or a cartridge alone is the game, and stays. It's a setting, on by default (Settings > Email > PriceCharting's deal emails), and Deals says how many were left out.
- **The acorn is green again** (D140), with a dark brown cap, as the first logo had it: in the logo and the app's icons, beside every count of acorns, and on the website.

## 0.60.0 (2026-10-06): Add a game, the Stash and the Almanac

### Added

- **Add a game** (D137): type a game in by hand, from **Acorns > Add a game**, the Collection page's button, or the welcome guide. Pick the console (any console Squirrelcade knows, even one nothing was imported for), start typing the title (it suggests titles from that console's catalog, from IGDB when it's set up, and from the games you have), and add its condition, what you paid, when and a note. It stays on the console for the next game. Values stay empty until a PriceCharting export has the game. Opened from the welcome guide, it has **Back to the welcome guide**; on a console without a catalog yet, it says why only your own games are suggested (6 different games give a console its catalog: Settings > Platforms).
- **Ask for a feature, with your AI's help** (D138): paste docs/ai/request-prompt.md into Claude, ChatGPT or another AI; it asks a few questions, checks what Squirrelcade does already, and gives you GitHub's idea or problem form already filled in, which you look over and send. Ideas are labeled for review, and the approved ones go into a future version.

### Changed

- **Stash and Almanac** (D139, the owner's names): the menu's Collection is the **Stash** (what a squirrel keeps for winter; Collection updates is **Stash updates**), and Data is the **Almanac**, which now also holds **Statistics** and **Report** (with Platforms and Sets). Their addresses stay the same. The help keeps saying "your collection" in sentences, and the Settings page called Collection keeps its name.
- **Today is the home page** (D139): the squirrel and the name at the top left lead to Today from every page, and a new install opens on Today (Settings > Interface > Start page still chooses).
- **Turning the week from the calendar** (D139): where the whole week fits (a wide screen), the arrows sit on the calendar's left and right sides, so a click on the week itself turns it; on a phone they stay beside the title.
- **Squirrelcade works on its own** (D137): with no export, the Collection page shows the games added by hand (it said "Your collection is empty" until an export came), Today says "No export yet" with Add a game, values show as not known yet rather than $0, and the welcome guide offers **Add games one at a time** next to the upload. A console tracked through games added here gets its catalog a few minutes later, as after an export, not at the next daily run.
- **First-run setup from outside your home network asks for a setup code** (D136), which Squirrelcade writes in its log when it starts ("No account yet: ... setup code: ABCD-EFGH"), so nobody who finds a new install on the internet can claim it. From your home network, nothing changes.
- **The README, the install guide and the help** rewritten for newcomers: what Squirrelcade needs (and doesn't), three ways to install it (the guide, an AI walking you through it, or the short version), numbered steps with the words explained, how to find your server's address, Add a game, the setup code, ARM processors not supported yet, updating on each NAS (Synology's Container Manager keeps the old image unless it's deleted first), and automatic updates with tools that are still maintained (the original Watchtower was archived in December 2025). The webhook's fields are a table the in-app help can show.
- The upload boxes name spreadsheets too ("Drop your export or spreadsheet here").
- **The AI setup prompt** (docs/ai/setup-prompt.md, also Help > AI-assisted setup) works with smaller AI models on free accounts: a step-by-step interview that checks Squirrelcade can run on your machine first, then installs it, brings your collection in, and suggests extras such as an automatic updater.
- For sale and Sales are named under Acorns everywhere (messages and help), as the menu has them since 0.58.0.

### Fixed

- **A password manager can't fill a key box any more.** A password manager (LastPass) ignored every "leave this box alone" mark on the settings pages: it could fill a Squirrelcade sign-in password into key boxes and the sign-in name into the email username, and saving the page saved them, so the daily PC price check would send that password to IsThereAnyDeal as its key. Now a key or text box on the settings pages and in the welcome guide changes only when you type, paste, drop or dictate into it, and Squirrelcade refuses to save a key that's an account's password ("That's a Squirrelcade sign-in password, not this service's key"), from the settings pages, a settings file, or the API.

## 0.59.2 (2026-10-05): the wishlist's order, explained to Claude

### Changed

- get_wishlist says what the main list is ordered by: each game's acorns minus the variety in the top picks (games of the same console or series above it), as the Wishlist page shows. Cowork had noticed a game with 100 acorns ranked sixth, below games with 91 to 94, without a reason. The connector's instructions to Claude name get_wishlist and what acorns are.

## 0.59.1 (2026-10-05): one game's acorns, and why

### Added

- Ask Claude for one game's acorns: get_wishlist takes a title ("halo reach") and answers with the game's acorns on each console where it's on your wishlist, and the rules behind them. check_ownership's acorns for a game you don't have say why too.

## 0.59.0 (2026-10-05): acorns for Claude

### Added

- **get_wishlist** for Claude and other AI apps: your Acorns wishlist, best first, each game with its acorns (how much you want it, 0 to 100), its priority, its place on the main list and the rules that gave it the most acorns; for all consoles, one console's whole list, or one priority. ("What should I hunt for on the Switch?")

### Fixed

- **Cowork could read nothing:** every tool's description said its answers followed JSON Schema draft-07, and Cowork checks answers against 2020-12, MCP's own dialect, so it refused them all. The descriptions now leave the dialect to MCP's default, and a test checks every tool's answer with a 2020-12 validator.

## 0.58.0 (2026-10-05): the menu, rearranged

### Changed

- **The menu, in the owner's order** (D134): Today; **Collection** (your games and their pages, now with Collection updates under it); **Acorns** (games coming in and going out: the **Acorns wishlist**, as the wishlist is called now, Coming soon, Past releases, Deals, For sale and Sales, and **Acorns ranking**, the rules that give acorns); **Data** (Platforms and Sets); Friends; PC library; Settings; System; Help. On a phone, the bar at the bottom has Acorns in the wishlist's place.
- **Friends in the menu** (D135): All friends, then each friend by name (the eight most recently active; All friends has the rest), and Add a friend. **Each friend has a page** with their file, yours for them, and **Compare** and **Trades** as its tabs; the friend picker on those is gone.

## 0.57.0 (2026-10-05): Squirrelcade in Cowork

### Added

- **The plugin for Claude Code and Cowork** (D133): Settings › Claude and AI apps › **Download the plugin** makes a key and a plugin for the Claude app, uploaded in Customize › Plugins › Add › Upload plugin. Cowork and Claude Code on your computer then read your collection, with no command line: the plugin's small relay runs on the computer (it needs Node.js), so it reaches Squirrelcade on your home network, where Claude's own servers can't. It brings a skill that tells Claude when to use Squirrelcade. Its key is listed with the others, and revoked like them.
- The page warns when the address Claude would use is an address on the internet rather than your home network's.

### Changed

- The command for Claude Code adds Squirrelcade for every folder (`--scope user`), not only the one it's run in.

## 0.56.0 (2026-10-05): Friends

### Added

- **Friends** (D131, D132): a new item in the menu, to see your collection next to a friend's and find trades that come out even. Each of you keeps your own Squirrelcade, and you swap files that say what you have: **Your file for …** on your friend's card (send it by email, in a message, on a USB stick), and theirs dropped on the page (the .json, or a zip with it) or pasted. A file from someone new adds them as a friend once you've seen whose it is. Every file between two friends carries the same code, so a file from someone else asks first.
- **Compare:** one console at a time, the games you both have, only you have, and only they have, with each side's conditions and values, what they'd trade, and the games on your wishlist or theirs. Two copies are the same game by their PriceCharting entry, or by title on the same console (0.55.0's title matching: "Demon's Souls" is "Demons Souls").
- **Trades:** even trades by PriceCharting value, within 20% (a setting): something of theirs you want (on your wishlist, or missing on a console you collect) for one of your games, or two or three together, what they want first. **Pick any game of theirs** and see what of yours evens it out. Each side's games for trade that the other wants, and **Copy as a message** for each trade. What you'd trade: copies marked for sale or trade, and your spare copies (all but the best copy of each game).
- **Settings › Friends:** what your file shares (your collection, what your copies are worth, your wishlist's top 50, what you'd trade, your spare copies) and the name it gives you. It never has what you paid, your notes, where copies are kept, loans, photos or what you played. Also the margin for an even trade, and how long a friend's file counts (60 days).
- Help: **Friends**; the API's friends addresses and the file's format.

## 0.55.0 (2026-10-05): Squirrelcade in Claude

### Added

- **Claude and AI apps** (D127, D130): Squirrelcade is an MCP server, so Claude and other apps that speak MCP can read the collection, read-only. **Claude Code on your home network connects with a key** (Settings › Claude and AI apps › Make a key, shown once with the command to run; read-only, answering as your account, from the home network only unless a setting says otherwise, revoked in one click): nothing is opened to the internet. **Claude's own apps** (claude.ai, the desktop and phone apps) call from Anthropic's servers, so they need the sign-in from the internet, an opt-in that's off by default. Four tools: **check_ownership** (up to 50 titles at once: owned, subscription, possible or not owned, with a confidence, how the titles differ, near misses, the consoles it's on, and a missing game's wishlist place and acorns), **search_games** (title words, console, physical or digital, PC storefront, condition; a page at a time), **get_game** (each copy's condition, sealed, box, manual, region, grading and value; PC storefronts; reviews; Top 100 place) and **list_platforms**. Off until turned on in **Settings › Claude and AI apps**; its address is Settings › General's followed by /mcp.
- **Title matching for questions from anywhere** (D127): editions ("Yakuza 0 Director's Cut" against "Yakuza 0": owned, a different edition), printings ("[Platinum Hits]"), generic subtitles ("Cars 2: The Video Game"), franchise names ("Sid Meier's"), punctuation, accents, ™ and Roman numerals; a different number is always a different game, and near misses (a real subtitle, a remaster, a spelling) are listed, never counted.
- **Its own sign-in for apps on the internet** (D127, off by default): OAuth 2.1 as the MCP authorization spec describes (resource and server metadata, PKCE, tokens for this address only, refresh tokens rotated and a second use ending the connection, codes and tokens kept only as hashes). Apps: Claude by its published description, others by registering, only for the addresses allowed (claude.ai and apps on your own computer by default). Each answer is the signed-in person's view; what you paid and your notes stay out unless you let them in.
- **Guests** (D128): people without an account you name, with their email, who connect their own Claude; they prove the email with a one-time code (Cloudflare Access's, or one Squirrelcade emails), get a viewer's view without prices paid or notes, and every call shows their name.
- **Keys, connected apps and the latest calls** on Settings › Claude and AI apps, with Revoke and Disconnect; calls per key and per person per minute and per day (60 and 2,000), and a list of calls kept 90 days.
- **A digital copy claimed with a disc** (D129): in a copy's details, Claimed (with the day and the store), Not claimed yet, or Not offered for this one (Xbox's disc-to-digital, a code in the box). A claimed license outlives the disc: sold, the game still counts as owned, digitally. The Collection page filters by it.
- Help: **Claude and AI apps**, with the Cloudflare Access setup; the README's "Use Squirrelcade from Claude"; the API's MCP and sign-in addresses.

## 0.54.0 (2026-10-05): Today, rearranged

### Changed

- **Today's cards, rearranged** (D126): the game of the day beside the biggest price changes; the week; deals beside this week in game history; your collection beside completion, their tops in line, with the last update and loans under completion.
- **Out this week looks ahead:** arrows go a week at a time, up to 12 weeks ahead ("Out next week", "Out the week of Oct 19").
- **A game out on several consoles is one tile**, its consoles listed and their makers' colors stacked on its edge (blue PlayStation, green Xbox, orange Nintendo), the tile the same size as the others.
- **Acorns on deals and in game history:** each deal's game shows its acorns and reviews beside its name; a game in this week's history you don't have shows its acorns (and its place on your wishlist).
- The card with Review's first question is gone from Today: the "questions for you" chip at the top opens Review.

## 0.53.0 (2026-10-05): box art on the Top 100, reviews beside acorns, a smaller preference

### Changed

- **The Top 100 board shows the games' box art** (D123): each square keeps its color (green when you own the game, a dashed gold square when you don't), with the box in the middle and the rank in the top left corner. Games you don't have show their box in gray. On a phone, the squares keep just the rank.
- **Reviews beside acorns** (D124): wherever a game's acorns show, its reviews show too: IGDB's rating out of 100 with a small star (how many ratings on hover). A Reviews column next to Acorns on the wishlist, a console's missing games (sortable), Coming soon and Past releases; in Store Mode's verdict, Deals, Today's releases and game history, and the game drawer. The game of the day has a second ring for its reviews, in gold, beside its acorns.
- **Your preference as a small pill** (D125): the mark and the acorns it adds (🔥 +20, with the acorn), opening the levels with theirs. It's the new default; Settings > Interface > "Your preferences shown as" still offers the name or the mark alone.

## 0.52.0 (2026-10-05): acorns, and Today after your first look

### Changed

- **Acorns instead of a score** (D121): how much you'd want a game is counted in acorns now, so it's never taken for a review score. The pixel acorn shows beside the number everywhere it appears (the game of the day's ring, the wishlist, a console's missing games, Coming soon, Past releases, Store Mode, the game drawer, the PC wishlist), the tables' columns say Acorns, and every rule says how many acorns it gives ("Acorns by platform", "Acorns for a series you collect"...). Spreadsheets and messages say acorns too.
- **Acorns in the menu:** the page of rules (Wishlist > Scoring before) is Acorns now, a menu item of its own after Wishlist, and opens by saying what acorns are. It takes Store Mode's place in the menu: Store Mode is the button at the top (and the bar at the bottom on a phone).
- **The game of the day** shows its reviews (IGDB's rating out of 100, and how many ratings), says where its acorns come from, and its buttons fit on one line: smaller, your preference as its mark, and "FB Marketplace" for Facebook Marketplace (in the shop links you start with).
- **Deals on Today and Wishlist > Deals:** the best deals first (the biggest saving against the market value), across every console; pick one console, switch to your wishlist's games first, or show only new or sealed copies (as the listing's own title says). Before, Today showed only the wishlist's three highest, which for you were all PlayStation 3.
- **Your collection on Today** says unique games, and your goal is one small line ("84% of your 5,000-copy goal"); Statistics keeps the bar and the pace. The Collection page's tile says Unique games too.
- Today answers faster: game history and completion are kept for a few minutes.

## 0.51.0 (2026-10-05): a bar at the bottom on phones

### Changed

- **On a phone, a bar at the bottom** (D120): Today, Collection, Store Mode, Wishlist, and More for the menu, the way the mockup draws it. The menu button at the top still works too, and Today's own Scan a game button on phones gives way to the bar's Store Mode.

## 0.50.0 (2026-10-05): Store Mode's verdicts

### Changed

- **Store Mode answers as a verdict** (D119): the answer in large type on its color (green when you need it, a green tint when it's yours, gold to check, blue when it's on another console), with the one thing that matters most under it: its place on your wishlist, what yours is worth, or where you have it.
- **The game drawer's status tags:** HAVE IT ×2, TOP 100 · #1, WISHLIST #3 or MISSING at its top; with two copies or more, **List one for sale** under your copies.
- **The new squirrel everywhere:** the browser tab's icon and the phone home screen's are the brand kit's squirrel, on deep green.

## 0.49.0 (2026-10-05): a console's page, redesigned

### Changed

- **A console's page, as your mockup draws it** (D118): who made it, its generation and its launch in your region; its name large; how complete its catalog is as one bar in three parts (owned, missing, to review); its counts as tiles that open their tab; and how many games and copies you have, with their worth and its change over about a month.
- **The Top 100 as a board** of ten by ten: owned squares filled green, the rest dashed gold, a dot for RomM; a square opens its game, and the filters dim the others. Beside it, the **hunting list**: the games you don't have, best first, with where each one is. **List** shows the list with why each game matters, as before.
- **History:** the facts as tiles, and the launches and the end along a line.

## 0.48.0 (2026-10-05): Today, redesigned

### Changed

- **Today, as your mockup draws it** (D117): a greeting with what's waiting (deals below market, releases this week, questions for you); the game of the day with its box, its score as a ring and the points that count most, the price and shop buttons and "Another one" (it says which pick of the day it is); this week in game history beside it; the next seven days' releases on your consoles side by side, in their maker's color (blue PlayStation, green Xbox, orange Nintendo); deals by game, each listing's price against the market value as a bar, with All, Wishlist only and 25%+ off; a question from Review, answered right there; the last update, and the copies added here that PriceCharting doesn't have yet; the collection's pulse (copies, games and worth, your goal, copies added each year, copies by console); the biggest price changes; and the catalogs, Top 100 lists and sets closest to done.
- The game of the day on the Wishlist page is the same new card.
- The header's Store Mode is a green button with its name on a computer (still the camera on a phone), and your account shows its initial.

## 0.47.0 (2026-10-05): the new look

### Changed

- **The look from your brand kit** (D116, docs/design/redesign.md): a charcoal ground in dark mode (the header and menu a step darker, cards a step lighter than the page), the arcade green for what's yours and for going ahead (buttons with dark words on it), acorn gold for what's wanted, missing or to check, and the squirrel's brown. The squirrel holds an acorn now, and the wordmark is a little bolder. Light mode has the same colors on warm light neutrals, with darker shades wherever words are colored, so they stay readable. Silkscreen, a pixel typeface, is in for labels, scores and big numbers on the pages that come next.

## 0.46.0 (2026-10-05): games you own that your list lacks

### Added

- **Games you own that your list lacks come in** (D115, a setting, on): under your own list, Wikipedia and the other sources add only games released after the list; now they also bring in an older game they list when you own a copy of it, so the copy counts instead of waiting on Not in catalog. Nothing you don't own is added. Settings > Catalogs and matching turns it off.

## 0.45.2 (2026-10-04): fewer doubles still

### Fixed

- **A note in brackets or a bare edition** no longer keeps another region's release apart from a game the catalog has: "Grand Theft Auto: San Andreas" beside "Grand Theft Auto: San Andreas (GH only)", "Destiny: The Taken King - Legendary Edition" beside "Destiny: Taken King Legendary Edition".

### Changed

- Statistics' **Games** says it counts each game once, however many copies, as the Collection page does.

## 0.45.1 (2026-10-04): no doubles on Other regions

### Fixed

- **Other regions' releases no longer repeat a game the catalog has** under a title a few small words, punctuation or an edition apart ("The Walking Dead: The Final Season" beside "The Walking Dead: Final Season", "Mortal Shell: Enhanced Edition - Game of the Year Edition" beside "Mortal Shell: Enhanced Edition"): 13 such doubles left the owner's Other regions tabs. The same goes for a list you add whose games count once owned. Your own lists and Wikipedia match as before.

## 0.45.0 (2026-10-04): the PC library's pages together, Review under System

### Changed

- **The PC library's pages in one place** (D113): the menu's PC library opens to its pages, like Collection and Wishlist: the library, the **PC wishlist** (moved from under Wishlist; its old address leads to it) and **PC deals**, the PC wishlist's games on sale now (with PC game prices on; also **On sale now** on the PC wishlist). The PC deals email's button and the PC library's link to the PC wishlist led to a page that didn't exist; they open the PC wishlist now.
- **Review under System** (D113): one of System's pages now, at the top of them; the count of questions waiting shows beside System too, so it's seen with the menu folded.
- **A copy is a physical item** (D113): on Collection > Copies, a game's line counts its copies apart from the PC game ("1 copy, sealed, and on PC"; "2 copies, 1 sealed"), the column is **Copies and PC games**, and **More than one copy** is **More than once** (several copies, copies on several consoles, or a copy and the PC game).
- **RomM as an oval:** on Copies, playing a sealed game in RomM is an oval like the others, opening the game in RomM.

### Fixed

- **"Your collection on PriceCharting"** (Collection updates > Send to PriceCharting, beside the copies sold or removed here) opened a PriceCharting page that doesn't exist; it opens your collection there now. Found by the new monthly check of every outside address the app and its help point to.

## 0.44.0 (2026-10-04): games you have more than once

### Added

- **Duplicates under Copies:** the Collection page's Copies says in small type how many of them are duplicates: the second, third and further copies of the same item (two complete copies of a game, or a sealed one and an open one). The game itself still counts once among your games, so games plus duplicates make the copies, and copies match PriceCharting's Count. The number links to them: Collection > Copies > **Same item more than once**. Statistics' Copies says it too.

## 0.43.2 (2026-10-04): other names that tell games apart

### Fixed

- **An edition's name stays its game's:** 0.43.1 left out every other name two IGDB games share, so "Mother 2" stopped counting as EarthBound because "Mother 2: Perfect Edition" goes by it too. A name another game shares is kept now when that game is only an edition of it. A name in two alphabets ("Tomb Raider: Хроники", read as plain "Tomb Raider") is left out, so a Tomb Raider copy no longer counts as Tomb Raider Chronicles.

## 0.43.1 (2026-10-04): a copy counts only for its own game

### Fixed

- **A copy no longer counts for another game through a name IGDB gives both:** IGDB has a file name, "Game.exe", as another name of hundreds of games, and some names belong to two games. Taken as the games' other names, they made two games one, so a copy could count for a game you don't have: a Rune Factory: Guardians of Azuma copy counted as Marvel Cosmic Invasion through the cross-generation rule. Such names are left out now, from IGDB's data and from the catalogs' games (the other regions' games kept them; the next build drops them).

## 0.43.0 (2026-10-04): remakes beside their originals

### Changed

- **Remakes beside their originals in a series:** an opened series in release order (or missing first) puts each remake or remaster right after the game it remakes, marked "remake of ..." (a remaster of a remake: "a version of ..."), from IGDB's links between games; in a story order, a remake you didn't place takes its original's place. IGDB's links come with each console's next IGDB download (System > Tasks > Update IGDB data does it now).

## 0.42.0 (2026-10-04): publishers' lists as sources, box art in the deals emails

### Added

- **Web pages of publishers' releases as catalog sources:** an online list can now be a page with a table for each console, the console in the heading over it (Wikipedia's page of Super Rare Games' releases), or a table whose cells name each release's consoles on their lines, such as "105 (PS4)" (Wikipedia's list of Limited Run Games' releases): each console gets its games, each with its own date. Columns named "Date released", "Release date(s)" or "Platform(s)" are understood too.

### Changed

- **Box art in the deals emails:** the PC deals email shows each game's box art beside its price and badges, and a message about a deal on your wishlist's top games (PriceCharting's deal emails) comes as a card with the game's box art, its console and place on your wishlist, the price and a link to the listing.

### Not added

- **CheapShark as a third PC price source** (D112): its API is meant to answer a person's own searches, and its documentation warns that automated requests keeping a store of its prices meet rate limits, up to a permanent block. Checking the PC wishlist's prices on a schedule is that, so IsThereAnyDeal and GG.deals stay the sources.

## 0.41.0 (2026-10-04): your review, part 5: catalog sources you add

### Added

- **Catalog sources you add** (D111): Settings > Sources > Catalog sources > **Add a source** takes an online list (a CSV file's address, a Google sheet shared with anyone who has the link, or a web page with a table of games) or a CSV file, and shows what it found before anything changes: its games by console, regions, years, the columns it read, and consoles it doesn't know. Added, it's a source of its own in the order, at the bottom until you move it, so you can add several lists, each with its own place. A list with a Platform (or Console, or System) column covers several consoles; one without is for the console you choose. Its games count toward completion, or only once you own one, as other regions' releases do. Its details rename it, change how its games count, read an online list again or remove it (its games leave the catalogs; those you answered about stay). An online list is read again whenever catalogs are refreshed; one that can't be read keeps its games and says why.

### Changed

- "Switch" alone and "Xbox Series" are recognized as console names, in lists and elsewhere.

## 0.40.2 (2026-10-04): other regions' releases only add games

### Fixed

- **Other regions' releases no longer change the games already in a catalog:** IGDB's entry for a game your list or Wikipedia already has gave that game its names and its evidence of a physical release from any region, so 'not confirmed physical' games turned missing and some copies matched differently. The IGDB (other regions) source now only adds new games.

## 0.40.1 (2026-10-04): your lists keep their copies

### Fixed

- **A game on your list keeps its copy when IGDB names it differently:** with other regions' releases in, a copy whose title matched IGDB's name for a game went to that other-region entry, and the game on your list (matched by its edition or another name) turned missing: about 166 games on the region-free consoles. Another region's entry now takes only copies no other catalog game claims.

## 0.40.0 (2026-10-04): your review, part 5: other regions' releases

### Added

- **Other regions' releases in your catalogs** (D110): on a console that isn't region-locked (Settings > Platforms > Region-locked consoles; by default the Switch, PlayStation 3 to 5, Xbox One and Series, the Game Boys and the DS aren't), IGDB's PAL, Japanese and Asian physical releases that your other sources don't list join the catalog, at the bottom of the source order (Settings > Sources: "IGDB (other regions)", on for every install, yours included). Each counts once you own a copy, so your PAL Super Rare Games stop sitting in "Not in catalog"; one you don't own waits on the console's "Other regions" tab, neither missing nor recommended, and your percentages don't drop. A region-locked console keeps other regions apart, as before (the Super Famicom beside the Super Nintendo). Add-ons, bundles and download-only games stay out. Needs IGDB.

## 0.39.0 (2026-10-04): your review, part 4: more places to shop

### Added

- **More places to shop, in groups:** 18 shop links to start with (Settings > Interface > Shop links, up to 40): used marketplaces (eBay, Mercari, Facebook Marketplace, OfferUp), game stores (eStarland, DKOldies for older consoles, GameStop), new games (Amazon, Best Buy, Walmart, Target for current consoles, Deku Deals for Switch), imports and PAL (Play-Asia, Solaris Japan), limited releases (Limited Run Games, Super Rare Games) and off the beaten path (Whatnot, ZenMarket for Japanese auctions). A link's fourth part names its group. In a game's drawer they fold under "Shop for it", by group; lists, Store Mode, the game of the day, a shared wishlist and a game check show the first three. An install that changed its shop links keeps its own.
- **GG.deals prices, beside IsThereAnyDeal's** (Settings > Sources > GG.deals, with your free key): its best price now and lowest ever for the PC wishlist's Steam games, in retail stores and key shops, read with the PC prices check. "Which prices come first" picks the source the PC wishlist shows where both have one; the other fills in. GG.deals is credited with a link wherever its prices show, as its terms ask. Deal messages still come from IsThereAnyDeal's prices.
- **The PC library's views are tabs**, as on a console's page: every PC game, on PC and a console, only on PC, and play it on PC, keep it sealed.
- **Play it on PC, keep it sealed** (PC library, the view that was "Sealed on a console, not on PC"): each game you keep sealed on a console and don't own on PC shows its PC version from the PC wishlist, with today's price, how much off and whether it's the lowest ever (with PC game prices on), so you can buy it on PC, play it there and keep the box sealed. A price drop already sends a message.
- **Nicer emails:** every email has Squirrelcade's look (the wordmark on forest green, the message on a white card, an Open Squirrelcade button), and the sender shows as Squirrelcade (the install's name) rather than the bare address. The PC deals email lists each game on its own row: its price and store, a badge for how much off and one for its lowest ever, and a link to the deal.

## 0.38.0 (2026-10-04): your review, part 3: your series, story order

### Added

- **Set up your series** (Sets > Series > Set up): choose which series show, with a check box for each, a search, and all or none; and add series of your own, each a name and the words its games' titles have ("Yakuza" with "Yakuza, Like a Dragon"). Your own series come from your consoles' catalogs, show with the others marked "Yours", and are listed whatever you own of them. Both are settings too (Settings > Collection > Series).
- **Story order:** an opened series can have its story's order ("Set its story order": move each game up or down, Yakuza 0 first and a remake right after its original). Set, the series opens in story order, each game's versions on different consoles together by release year; "Remove the story order" goes back to release order.

## 0.37.0 (2026-10-04): your review, part 2: one home for each service, email in one place, cross-generation games

### Added

- **Cross-generation games count for both consoles** (D108; Settings > Catalogs and matching, on by default): a game you have on one console counts on the console before or after it in its family when the two came out within two years of each other (a setting). Silksong on Switch 2 covers its Switch version, and the same goes for PlayStation 4 and 5, Xbox One and Series X|S, and the generations before them. The game shows where you have it ("Other generation"). Off, each version counts only on its own console.
- **Series show what you have on PC** (Sets > Series): after the green part of a series' bar, a blue part counts its games you don't have on a console but do have on PC (the PC library), with "+N on PC"; an opened series says which ones.
- **An opened series has an order of your choosing:** release year (the default), missing first, or A to Z, remembered on that device. Story order (Yakuza 0 before Yakuza 1) is still to come.

### Changed

- **One home for each service** (D106): every outside service has one card on Settings > Sources with its switch, its steps, its keys and its test together, whether it's on or off, so there's no more "turn it on in Features first". Settings > Features keeps the same switches, each with a link to its card and no key boxes. The PC library is set up on its own page (Settings > PC library) and the email account on Settings > Email. A service's task on System > Tasks links to its card, and so does the page of a part that's off.
- **Step-by-step setup, with links:** each service's card has "Set it up, step by step", folded until you open it: numbered steps, every outside page linked, with a web search for when a page moves. The steps for notifications and email providers fold the same way.
- **Email in one place** (D107): the new Settings > Email holds your email account once (provider, address, app password) and one test that checks sending and reading. Under it are switches for what uses it: notifications by email, collection updates from PriceCharting's export emails, and PriceCharting's deal emails. Your settings carried over as they were; a different mailbox for exports stays under Show advanced.
- "Find a setting" goes to a part's card even while the part is off.
- **Review in plain words:** Review's "Marked in the catalog" tab and each console's "Needs review" tab say what they ask and what each answer does, and the old system's reasons get a line in plain words.
- **Calmer tasks** (D109): the frequent checks (the watched folder, your email, reminders, the game of the day, the health check) still look as often, so a new export shows up within minutes, but a look that finds nothing stays out of the history; System > Tasks says when each last looked. How often achievements are read is now a setting (Settings > Tasks > "Read achievements every", once a day by default).
- **A list can mark a game as not confirmed:** a row of your own list whose status is Unconfirmed (or "not confirmed") waits for evidence of a physical release, as any unconfirmed game does, instead of counting at once.

## 0.36.0 (2026-10-04): your review, part 1: password managers, alerts once, backups in days

### Fixed

- **Password managers leave Squirrelcade's boxes alone** (D104): LastPass took any page with a key box for a sign-in. It filled your name into the game search, put a password into a key box on Settings > Sources (the "1 unsaved change" nobody made), and showed its button on dropdowns. Every box is now off-limits to password managers, except the sign-in, first-account and password boxes, which they still fill. Nothing was saved from those fills unless Save was clicked.
- **A failing task alerts once** (D105): every failed run sent an alert, so a broken email check alerted every half hour. Now it alerts when a task starts failing, at most once a day while it keeps failing, and once when it works again.
- **"Write why it matters" lines up** under each game on a console's Top 100: it moved around with the length of the developers' names. The same fix holds for every link that works as a button.

### Changed

- **Backups are counted in days** (D103): Settings > Tasks > "Back up the database every", from 1 to 30 days. New installs back up weekly; an install's schedule carries over (every 24 hours becomes every day). "Backups to keep" still counts backups, so weekly with 14 kept reaches back about three months, and the warning about an old backup follows the schedule (it shows a day past it).
- **A check mark beside a saved key:** every key, token and password box in Settings shows a big check mark next to its name when one is saved, and the box still says "Saved".
- **Games and copies, explained** on Collection: Games counts each game once, however many copies; Copies counts every copy, as PriceCharting does.

## 0.35.3 (2026-10-01): Squirrelcade's own GitHub organization

### Changed

- **The repository and the image moved to the squirrelcade organization:** github.com/squirrelcade/squirrelcade and ghcr.io/squirrelcade/squirrelcade (the old addresses forward to the repository). An install that pulls the image by its old name changes the image line of its compose file once: the update checker can't follow a new name.
- **No purple left from the old look:** the badges and charts that were still purple take the new look's colors. Sealed copies, a console's Top 100 rank and the Condition chart are in the squirrel's brown (a color from the logo); "Not out yet" and a copy moved to another title in blue; a Game-Key Card, "Need it if physical" deals and "On the shelf" in cyan; the Genres chart in pink; a console's completion bar in forest green.
- The Pushover icon in docs/brand is now 128 × 128 pixels on a transparent background (pushover-128.png), the size Pushover asks for.

## 0.35.2 (2026-10-01): the header fits a phone

### Fixed

- **The header stays one line on a phone:** the name Squirrelcade is longer than the old one, so on an iPhone's width the header broke onto a second line, with the squirrel hanging over its green edge. Now the name gets a little smaller where room is short, and the narrowest phones show the squirrel alone.

## 0.35.1 (2026-10-01): the new logo at once, and only Squirrelcade's names

### Fixed

- **The new logo at once:** after 0.35.0 a browser could keep showing the old controller icon in the header and on the sign-in page, because the copy of the files kept for opening with no signal answered before the server did. The squirrel is now part of the page itself; the icons and the manifest come fresh whenever there's a connection (the kept copy only without one); and that copy is renewed when any file changes, its name or what's in it.
- **What you type in a copy's window stays typed** (where it is, the asking price, a note): a refresh of the game's drawer could empty the window in Safari before it was saved.
- **Long folder paths wrap on a phone** (Collection updates' watched folder, System > Backups' folders): a long one pushed the page sideways.

### Changed

- **Only Squirrelcade's names** (D102): the sign-in cookie (everyone signs in once more), the calendar file's event ids (a calendar that imported the coming releases sees each one replaced once), what the browser keeps (the copy for no signal, recent games, the views you chose), the image (ghcr.io/zebshine/squirrelcade) and the repository (github.com/Zebshine/squirrelcade).
- **The names from before 0.35.0 are no longer read.** An install from then renames its files before updating: the database gamefolio.db to squirrelcade.db, its backups gamefolio-... to squirrelcade-..., GAMEFOLIO_ variables to SQUIRRELCADE_, and a settings file's format to "squirrelcade-settings" (the one such install was moved on 2026-10-01).
- `scripts/make-icons.mjs` draws every logo file from the squirrel's grid (it still drew the controller).

## 0.35.0 (2026-10-01): Gamefolio is now Squirrelcade

### Changed

- **A new name: Squirrelcade** (D99). Another app was already called Gamefolio, so before going public this one got a name of its own: a squirrel stashes for winter, and "-cade" is for the arcade. Everything you see says Squirrelcade: the pages, Help, the messages it sends, the files you download and the AI-assisted setup prompt.
- **A new look** (D100, D101): the pixel squirrel hugging its acorn is the icon everywhere (the browser tab, your phone's home screen, the header, the sign-in page), and the colors are forest green with the squirrel's orange. Headings and the name are set in Fredoka, a rounded typeface Squirrelcade serves itself (nothing is fetched from elsewhere). On a phone, add it to your home screen again to get the new icon.
- **Nothing to do on an install from before:** your collection, settings, sign-in and backups stay as they are. The database keeps its file name (gamefolio.db) where it already exists, backups named gamefolio-... are listed, kept and restored like the new squirrelcade-... ones, settings files exported as Gamefolio still import, and the environment variables still work under their old names (GAMEFOLIO_*) beside the new ones (SQUIRRELCADE_*). What your phone keeps for Store Mode with no signal, including purchases waiting to be sent, stays too.

## 0.34.1 (2026-09-30): wrong barcode links undone, whole backups, and directions that match the menus

### Fixed

- **A barcode linked to the wrong game can be unlinked:** nothing in the app could undo a mis-tap on **This is it**, so Store Mode kept naming the wrong game for that barcode. Store Mode now has **Not this game?** under a barcode linked before, and Scan my shelf has **Undo** beside each game linked on the visit and **Not this game?** on one Already known. A barcode saved before with the zeros some phones add in front is replaced by a new link rather than left beside it, and an export's barcode never takes the place of one you linked, in either form.
- **Each backup a file whole by itself:** 0.34.0's check opened each new backup in a way that left two small files beside it ("-shm" and "-wal"), two more every day and never cleared. A backup is now one file that needs nothing beside it (copy it anywhere), and checking it leaves nothing behind.
- **IGDB's steps, as IGDB gives them:** Help, the IGDB setting and the AI-assisted setup prompt now say what IGDB's own instructions do: a Twitch account with two-factor sign-in, and the application's client type **Confidential** (a Public one has no client secret, so the keys couldn't be made). The welcome guide already said so.
- **Directions to the wishlist's settings:** Help's Sharing page and the welcome guide sent you to "Settings > Wishlist", which isn't in the Settings menu. Those settings are on **Wishlist > Scoring**.
- **Two settings pages by their names in the menu:** "Settings > Catalogs" is now written **Settings > Catalogs and matching**, and "Settings > Storage" **Settings > Storage and backups**, in Help, the install guide, the AI prompt and the app's own hints and messages.
- **A test keeps these directions right:** it checks every "Settings > page > section" in Help, the install guide, the AI prompt, the README and the settings' own descriptions against the pages and sections the app has.

## 0.34.0 (2026-09-30): backups checked

### Added

- **Every backup is checked** (D98): a new backup counts only once SQLite's own check says it's sound (about a second for a collection of thousands). One that fails is set aside (never listed, never restored), the older ones are kept rather than pruned for it, and the backup task fails, so you get the problem message. Its copy in the second backup folder must come out whole too (a share that filled up or dropped mid-copy leaves a short file).

## 0.33.1 (2026-09-30): no zooming into fields on an iPhone

### Fixed

- **On an iPhone, tapping a field zoomed the page in** (and left it zoomed): Safari does that for any field whose text is smaller than 16px, as most of Gamefolio's were (Settings, a copy's window, the drawer, what you paid...). On a touch screen, every field's text is now at least 16px. Store Mode's search was already big enough.
- Scan my shelf leads with a full-width **Scan a game**, the typed barcode below it.
- Sales' three totals (this month, this year, every sale) sit side by side on a phone too, instead of a screenful of cards.

## 0.33.0 (2026-09-30): scan my shelf

### Added

- **Scan my shelf** (D97; Store Mode > Scan my shelf): teach Gamefolio your own games' barcodes, at home at an easy pace. Choose the console on the shelf, scan a game (or type its barcode): one Gamefolio knows says so at once; for a new one, a few letters of its title find it among your games on that console, and "This is it" saves it. Each console shows how many of its games have their barcode. Store Mode then knows your games at once in a store, even with no signal, and never asks the barcode service about them: this page never asks it either. The first of the next steps in GitHub issue 1 (naming barcodes without depending on an outside service).

## 0.32.1 (2026-09-30): the welcome guide points to AI-assisted setup

### Added

- **The welcome guide points to AI-assisted setup:** after its five steps, it says an AI you use can take you through connecting everything else, with a link to **AI-assisted setup**: from the first visit, as the owner imagined it.

## 0.32.0 (2026-09-30): what you paid, right in the store

### Added

- **What you paid, in Store Mode** (D96): right after **I bought it**, the game's row says **Bought here, not on PriceCharting yet**, with **undo** and **what you paid?**, which takes the price there and then, saved on the copy (the list of copies added here has it too, for later). Sales then knows what each sale made over its cost, and Improve your collection has one fewer copy to ask about.

## 0.31.2 (2026-09-30): ready by the time you look, and the Super Famicom's achievements

### Fixed

- **Right after a copy changes** (I bought it, Add a copy, a sale), Gamefolio works out the wishlist again in the background, while your phone shows the change, so the next search or page finds it ready (on the server's data: 0.05 s instead of 1.6).
- **RetroAchievements on the Super Famicom** (and the other regions' consoles of their own: the Famicom, the PC Engine, the Japanese and PAL Mega Drive, the Nintendo 64 (Japan)...): a game RetroAchievements lists as "SNES/Super Famicom" went on the Super Nintendo only, so a Super Famicom copy's drawer never showed its progress. It now goes on the console you have the copy on, as Xbox's and PlayStation's do.

## 0.31.1 (2026-09-30): a search right after I bought it, fast again

### Fixed

- **Store Mode right after "I bought it"**: since copies became Gamefolio's own (0.19.0), any copy added or changed made every console's catalog count again, so the next search took about 11 seconds on a collection of 4,000 copies and 26 consoles. Now only that console counts again, the counting itself is about four times faster, and your tastes (for the wishlist) are learned again after an update or once an hour rather than after every copy: the search takes a second or two. The first page after Gamefolio starts waits about 3 seconds instead of 11, and each console keeps only its latest results (every change used to leave the old ones in memory). What counts as owned is the same as before, game for game.

## 0.31.0 (2026-09-30): settings an AI can write

AI-assisted setup, one step further: the AI can set Gamefolio up itself, by writing the settings, and you load them.

### Added

- **A settings file from your AI** (D95): the setup prompt tells the AI how to write the settings you chose into a file (never a password, key or token), and you load it with **Settings > Import**. The prompt with every guide ends with every setting's key, what it takes and its default, so the AI writes only settings Gamefolio has.
- **Settings > Import shows what a file changes** before it's applied: each setting, its value before and after (a password or key only as "replaced"), and any name in the file that isn't a setting.
- The Unraid template has the optional Playnite and second backup folders, and the README's list of what Gamefolio does covers 0.14 to 0.31.

## 0.30.0 (2026-09-30): one in, one out

For the owner's plan to hold the collection at its goal, then play a game and sell it.

### Added

- **One in, one out** (D94): with a goal set (Settings > Collection > Your goal), a copy that puts the collection at or over it (I bought it, in Store Mode or a game's drawer, or Add a copy) says so as it's added, and that Collection > Sales has what to sell.

### Fixed

- The PC library's Steam achievements filter shows its whole choice ("With Steam achievements").

## 0.29.0 (2026-09-30): AI-assisted setup

The owner's idea: setting up everything Gamefolio connects to is the hard part for anyone installing it, so let their own AI take them through it.

### Added

- **AI-assisted setup** (D93), first in Help: a prompt to paste into the AI you use (Claude, ChatGPT, Gemini, Grok...), or to attach as a file. The AI interviews you first (your server, your collection, your phone, the services you use or would install), writes a plan, then takes you through it one step at a time, checking each part with its test. The prompt is made for your Gamefolio: what's set up already (the version, the collection, which parts are on and whether they work, messages, sign-in, backups, what needs attention) and a link to each setting on it. It never includes passwords, keys or tokens, and it tells the AI never to ask for one: you type each into Gamefolio yourself. **Download it with every guide** puts the prompt and all the guides in one file. Before Gamefolio is installed, the same prompt is in the repository (docs/ai/setup-prompt.md), and the AI starts with the install.
- The setup checklist (System > Status, and Today while it's unfinished) links to it.
- A link to an advanced setting (in the prompt, say) shows the advanced settings, instead of landing where the setting is hidden.

### Fixed

- **Copy buttons on plain http://** (the selling helper's listing, the list for PriceCharting's importer, invite and share links, the API key): browsers let a page use the clipboard only over HTTPS (or on the server itself), so at home over http:// they did nothing. They now copy there too, and say so if a browser still won't.
- Store Mode's camera, on a page that isn't HTTPS, says what would make it work for any install (Tailscale, a tunnel or a reverse proxy), instead of naming the owner's own Cloudflare address.

## 0.28.0 (2026-09-30): Steam achievements

The last of the achievements step, the owner's request.

### Added

- **Steam achievements** (D92): Settings > Features > Steam achievements reads your achievements through Steam's own Web API, with a free key and your Steam profile (its address, custom name or ID). In the PC library, each Steam game shows its achievements beside it (34/50, or All with a trophy), and a filter shows the games completed on Steam, or with any achievement. The first read asks about each game you've played; after that, once a day, only about the games played since. Your profile's game details must be public, and the Test button says if they aren't. Viewers see them when Settings > Security shares what you played with them, as with the consoles' achievements.
- **Checked against bad input**: each of the server's 205 routes is tested with wrong ids, queries and bodies, and must answer with what was wrong, never fail.

## 0.27.0 (2026-09-30): services and tools, in Help

### Added

- **Help › Services and tools** (D91, the owner's request): every outside service, program and tool Gamefolio works with or recommends, in one place, each linked to its own site or official project. For each: what it does for you, what you need (an account, a key, a drive), what it costs, and where it's set up in Gamefolio. It covers your collection's sources, game information, barcodes, what you play, selling, ripping, messages, running and reaching Gamefolio, and programs that read it. Optional parts and Settings › Features point to it. A test fails when a new optional part, a way to send messages or a barcode service has no entry, so the page keeps up.

## 0.26.0 (2026-09-30): ripped, where a PC can rip

### Changed

- **Ripped** (D90, the owner's request) is offered, to start with, on the consoles whose discs a PC can rip in full. That's a Blu-ray drive flashed with [OmniDrive](https://github.com/RibShark/OmniDrive) (an ASUS BW-16D1HT, or one of several LG drives) and [redumper](https://github.com/superg/redumper), Redump's dumper. It covers PlayStation 1 to 5, Xbox, Xbox 360, Xbox One, Series X, GameCube, Wii, Wii U, Sega CD, Saturn and 3DO. PSP and Dreamcast are left out: their discs need their own console. Settings > Collection > Consoles whose games you rip still takes any console: with a cartridge reader, add its consoles, and a listing then says "The cartridge was read in full". Selling your games (in Help) says how to rip.

## 0.25.0 (2026-09-29): sell while it's worth more

### Added

- **Worth more lately** (D89): Collection > Sales' **Ready to sell?** also lists the copies whose value rose the most since about a year ago (or since the first price Gamefolio kept, when that's more recent), with how much and since when ("up $12.50 (+25%) since 9/1/2026"), to sell while the price is up. Keepers and copies already for sale are left out, as on the other lists.

## 0.24.0 (2026-09-29): Xbox achievements and PlayStation trophies

The next step of the hub: where you play, beside what you own.

### Added

- **Xbox achievements** (D88): Settings > Features > Xbox achievements reads your achievements every day through OpenXBL, with a free key you make at xbl.io by signing in with your Microsoft account. Under Played, each game's drawer shows how many achievements you have, the gamerscore, how far you are and when you last played. A game on several consoles (Smart Delivery) goes on the one you own a copy on.
- **PlayStation trophies**: the same for PS3, PS4, PS5 and Vita, with the platinum. It signs in with a token you copy from your browser, which lasts about two months (Settings says until when). It's unofficial: it uses the PlayStation App's API, through psn-api.
- Both can mark the games you completed as **Completed** in What you played, when they have no status of yours. Completed games then show on Sales' **Ready to sell?**.

### Fixed

- **Links to a setting land on it**: Go to Settings › Features and Find a setting scroll to the setting even when the settings take a moment to load (before, the page stayed at its top).

## 0.23.0 (2026-09-29): a goal for your collection

### Added

- **Your goal** (D87, for the owner's plan to hold at about 5,000): Settings > Collection > Your goal takes how many copies (or games) you mean to have. Today and Statistics show how far you are, the change over the last 12 months (copies that came, by the day bought, less the ones that left) and when you'd get there at that pace ("about May 2027"). Once you're there, they show how many are over it, with a link to what to sell.

### Fixed

- **A copy's place, tags and sale kept as typed:** in a copy's window, where it is, its tags and whether it's for sale could be typed before the saved ones had come, and then were overwritten by them (on a slow connection, a place typed at once was lost). Those fields now wait for the saved ones.
- A dialog opened to type something (a share link's name, why a game matters, a copy's price paid) starts with the cursor in that field: typed at once, the first letters could go to the dialog's close button, which took the focus a moment later.
- The words of the messages in the corner ("IGDB: ...") were a gray too faint to read easily on their card, in both themes; they're the readable gray of the rest of the app now.

## 0.22.0 (2026-09-29): selling your games

For the owner's plan: play a game, then sell it for enough for a lunch.

### Added

- **Ready to sell** (D86, the owner's idea): a copy's listing for **eBay** or **Mercari**, written from what Gamefolio knows about it. The title has up to 80 characters, with its condition in buyers' words ("CIB Complete", "Disc Only", "New Sealed") and "Tested" when it works. The description says what comes with it, when it was tested and ripped, your note for buyers and the end you give every listing. eBay's item specifics include the UPC when a barcode was scanned. Each part has a Copy button, and there's the marketplace's condition. Its price: PriceCharting's value, your asking price (**Mark it for sale**) and what a sale leaves you after the marketplace's fees and shipping, with the game's sold listings a click away. Its photos: the ones taken, the standard ones still to take, and **Download the photos** in a zip named by place. It opens from a game's drawer, a copy's window, For sale and Sales. Nothing is posted: you copy it into the marketplace's form.
- **Ripped** (the owner's idea, for PS3 and Xbox 360 above all): on the consoles whose games you rip (Settings > Collection > Your copies; the disc consoles by default), a copy's window records a full read of its disc (**Read fully**, **Read with errors** or **Couldn't be read**), shown as a badge of its own. A full read puts "The disc was read in full and verified without errors" in the listing.
- **Collection > Sales**: this month's, this year's and every sale's money after fees and shipping, in meals too (15.00 a meal, a setting), and what they made over what the copies cost. **Ready to sell?** suggests games you've finished and extra copies of games you own twice (never a keeper: tag a copy "Keeper"). Each sale has **take back**, and **Download** gives them all.
- Settings > Collection > Selling: the fees, shipping, a meal's price, the keeper tag, the end of every listing, and your country's eBay. A new help page, Selling your games.

### Changed

- **Sold** in a copy's window asks what it sold for, where and when, so the sale counts on Sales. **Take it out without a sale** works as before.

## 0.21.0 (2026-09-29): tests, standard photos, estimates, and Improve your collection

### Added

- **Tested** (D84, the owner's idea): a copy's window records a test (**It works**, **Works, with problems**, **Doesn't work**, and a note), each kept with its day and time; the drawer shows the last one and records **tested: it works** in a tap; the Collection page shows it with the copy.
- **Standard photos** by what a copy has and what its console plays games from: a disc game complete in its box has Box front, Box back, Inside, Disc front and Disc back; a sealed copy only its box; a loose cartridge its front and back (Card for Switch, DS, 3DS and Vita). Each is a button in the copy's window (the phone's camera), and the photo takes that place. The names are settings (Settings > Collection > Your copies).
- **Estimated prices** (D85), for a copy whose price you don't know: a field of its own in the copy's window, empty unless you fill it in (Gamefolio estimates nothing on its own). **Suggest** proposes one (with its box, the console's usual price for a new game; without, half of it), to keep or change. Shown in grey in the drawer and on the Collection page, and added up beside what you paid on Statistics; never a price paid, never in a download or sent to PriceCharting. The usual prices (US by default), the share, and the Suggest switch are in Settings > Collection > Suggested estimates.
- **Collection > Improve**: what copies are missing (a price paid or your estimate, the day bought, a standard photo, a test, where it's kept), by tab and console, filled in one copy at a time with **Next copy**. What counts is a setting; **Test a copy again after** brings old tests back onto the list.

### Changed

- A price paid of 0 (how PriceCharting writes one it wasn't given) shows as not known in a copy's window.

## 0.20.0 (2026-09-29): add games in Gamefolio, and send them to PriceCharting

### Added

- **Add a copy** (D83): a game's drawer adds a copy of it (a second copy, or a game no export has), with its condition, what you paid, when, and a note. It counts at once.
- **Change a copy:** under each copy, its condition, price paid, day bought and notes, for any copy (one from PriceCharting too), and **Sold** or **Remove**. What you change stays yours: no export overwrites it, and the export still finds the copy.
- **Send to PriceCharting** (Collection updates): the copies added in Gamefolio as lines for PriceCharting's importer, with **Copy the list**, **Open PriceCharting's importer** and **I've added them there**. The next export brings each one's value to the same copy (no second one), keeping what you paid. Copies sold or removed here that PriceCharting still lists are there too, to remove on PriceCharting; the export doesn't bring them back.

### Changed

- **I bought it** (Store Mode and a game's drawer) adds a real copy, bought today, in the condition set in Settings > Collection > Adding copies (complete in box unless you change it), instead of marking the game owned until an export had it. Store Mode's list under the answers is the copies added here that aren't on PriceCharting yet, each with undo; bought without a connection, it's added once the connection is back. Games marked bought before this version become such copies at the first start.

## 0.19.0 (2026-09-29): Gamefolio keeps your collection

The first step toward Gamefolio as the hub of your collecting, with the other services around it.

### Changed

- **Every copy you own is a record of its own in Gamefolio** (D81), and a collection update (PriceCharting's export, your spreadsheet, another app's export) updates those copies instead of replacing the collection. Two copies of the same game in the same condition are two copies now, each with its own place, tags, loans and photos.
- **A copy an update no longer has waits on Review** (D82), still counted, until you say: **I still have it** (it's your own copy from then on, and no export removes it), **Sold**, or **Gone**. They're on Review > Copies, counted on the Review menu; the Collection page and the game's drawer mark them; each update's report says how many copies it matched, added or left waiting. To have them leave with the update as before: Settings > Collection > Safety > A copy the next update no longer has.
- **A spreadsheet beside PriceCharting:** your own list (or another app's export) adds the games PriceCharting doesn't have and doesn't double the ones it has; a later PriceCharting export takes over the spreadsheet's copy of the same game, with its prices.
- The Collection page lists each copy on its own row (no Qty column), and Statistics' most valuable copies list a game in a condition once.

### For existing installs

- At the first start, the current collection becomes Gamefolio's copies, with the same totals: a row of 2 copies becomes 2 copies, and the details, loans and photos you kept for a game in a condition stay with its first copy. The database is copied first, as before every update.

## 0.18.0 (2026-09-29): RetroAchievements

### Added

- **RetroAchievements** (D80, from the ideas list): Settings > Features > RetroAchievements, with your username and its free web API key, reads your progress every day: each game's drawer shows your award and achievements ("Mastered · 72 of 72 achievements"), linked to the game there. Games are matched by console (RetroAchievements' names, "SNES/Super Famicom", "Genesis/Mega Drive"...) and title ("Legend of Zelda, The - A Link to the Past" is The Legend of Zelda: A Link to the Past); hacks, homebrew and subsets are left out. Optionally (Settings > Sources > RetroAchievements > In What you played), games you've beaten are marked Beaten and mastered ones Completed, when they have no status of your own.

## 0.17.0 (2026-09-29): an upgrade list

### Added

- **Collection > Upgrades** (D79, from the ideas list): the games whose best copy isn't complete (loose, or without its box or its manual), the ones you like best first: your rating, then IGDB's, then what your copy is worth. Each has **Price on PriceCharting** (the game's own page for a PriceCharting export's copy, with what a complete copy costs). Filters for what's missing and the games you rated. Viewers see it too, as gift ideas, without your ratings unless you share what you played.

## 0.16.0 (2026-09-29): a second barcode service

### Added

- **UPC Database** (upcdatabase.org) as a second barcode service (D78, the owner's find): Settings > Sources > Barcodes chooses UPCitemdb, UPC Database (with a free account's key), or UPCitemdb then UPC Database for barcodes UPCitemdb doesn't know (and on its own once UPCitemdb's lookups are used up for today). A barcode UPCitemdb didn't know before is asked of UPC Database once it's chosen; each kept name notes which service gave it, and the log says which answered. A key UPC Database doesn't take is said as such, with where to change it.

## 0.15.0 (2026-09-29): other apps' exports, as they come

### Added

- **Exports from other collection apps** (D77): CLZ Games, GAMEYE and VGCollect exports go in as they come, on Collection updates. Their console names become Gamefolio's ("Super Nintendo (SNES)", "SNES", "Microsoft Xbox", "Nintendo 64 [EU]" with its region tag), only the games you own come in (no wish list, sold or on-order rows, no systems or accessories), and their columns are read by their own names (GAMEYE's Ownership, Your price and Created at; CLZ's Collection Status and Completeness; VGCollect's Cart, Box and Manual marks, its price as what you paid). The report says how many rows were left out and why.
- **Barcodes from an export:** a file with a Barcode (UPC, EAN) column, such as CLZ's, gives Store Mode those games' barcodes: scanned, they answer at once, with no barcode service. A barcode you linked by hand keeps its game.

### Changed

- **Consoles by their common names:** a spreadsheet's console written another common way ("SNES", "PS4", "Game Boy Advance") becomes PriceCharting's name for it instead of a console of its own, and a CSV separated by semicolons or tabs is read too. Dates written day first (25/04/2022) are read that way when the file writes them so.

## 0.14.0 (2026-09-29): barcodes remembered, and paced

### Changed

- **Every barcode name is kept for good** (D76): what the barcode service calls a barcode is saved in Gamefolio's database, not for a day in memory, so each game costs one of its lookups, ever, for everyone who scans it (the family check too), past a restart, and even with the service turned off later. A code it didn't know is asked about again after a week. A barcode you link to a game still wins.
- **Scanning fast in a store no longer fails:** UPCitemdb's free use takes 6 lookups a minute (and 100 a day). Gamefolio never asks faster: a new barcode over the limit waits its turn and is looked up in the background, and Store Mode (and the family check) says so, counts down and asks again by itself. When the service itself asks to slow down, Gamefolio waits; when today's lookups are used up, it stops asking until they come back.
- **Lookups left today:** under a new barcode's answer, Store Mode shows how many lookups the service has left today (its own count), in bold once 10 or fewer are left, with when more come.

## 0.13.1 (2026-09-29): what's new, in better words

### Changed

- **Collection updates from your email** says when it uses your email notifications' account (its own fields left empty), with the address and server: nothing to type twice. Its fields and their "Not set" looked like they needed the app password again.
- **What's new's short view** (after an update that skipped several versions) says what each change is: a bold lead-in only when it labels the line, else the line's first sentence without its asides, shortened at a comma or between words. Before, a bold word in the middle of a line ("recommended") or a file name could stand for the whole change, and long lines were cut mid-word.

## 0.13.0 (2026-09-29): each console's value over time

### Added

- **Value by platform over time** (Collection > Statistics, D75): each console's value at every collection update, for the 12 most valuable: a small line, the value now and the change since the first update, in green or red. Each applied update now keeps its platforms' totals with it, so they outlive the pruning of old updates' rows; an existing install fills them in at start-up from the updates it still keeps (usually the last few). `GET /api/v1/collection/history` gives them with each update (`platforms`).

### Also

- The setup guide (docs/guide) has pictures: eleven screenshots from a new install with a made-up collection, retaken by `scripts/guide-shots.mjs`. docs/BETA.md lists tonight's features for testers and what the browser keeps for offline use, and GitHub issue templates ask testers what they did, what happened, the version and where it runs.

## 0.12.3 (2026-09-29): a setup checklist that shows

### Fixed

- **System > Status's setup checklist** never showed on a new install: it waited for the PC library's and IGDB's pages, which answer only while those parts are on (the PC library starts off). It now shows either way, with a part that's off pointing to Settings > Features.

### Changed

- **Today** lists the setup steps first while a new install still has essential ones left (the collection, its catalogs, the first backup), for the owner only.
- **PC game sale messages** name the first 10 games (the PC wishlist's order) and count the rest. A first price check can find dozens of games on sale, and one message listing them all was cut off partway.
- **Barcodes the barcode service doesn't know** are noted in the log (System > Logs), as the ones it names already were, so a scan that finds nothing can be looked into.

## 0.12.2 (2026-09-29): scans that spare the barcode service

### Changed

- **A barcode scanned again** (twice in a store, or by family on the phone check) no longer asks the barcode service again: what it said is kept for a day (an hour for a code it didn't know). UPCitemdb's free use allows about 100 lookups a day, and a store trip can use a lot of them.

## 0.12.1 (2026-09-29): what's new, in a few words

### Changed

- **What's new** after an update that skipped several versions (a browser away for a while) lists each version's changes in a few words first, with **Show all the details** for the rest, instead of every paragraph at once.
- **Groundwork for ARM** (a Raspberry Pi, ARM NAS models): the image's JavaScript and its Playnite reader are built on the builder's own processor for the image's, and a hand-started workflow ("Try an ARM image") builds and starts an ARM image without publishing it. Published images stay Intel/AMD until that's checked.

## 0.12.0 (2026-09-29): Gamefolio opens with no signal at all

### Added

- **Opening with no connection** (D73): Store Mode already answered from the phone's copy when Gamefolio couldn't be reached, but only while the page was open; a phone that had closed the tab, in a store with no signal, couldn't open Gamefolio at all. Now its own files stay on the phone after a visit with a connection (a service worker keeps the page and the build's files, never the API's answers), and with no connection it opens with the last sign-in on that phone, saying only Store Mode works until Gamefolio answers again. Only while Store Mode's copy is on the phone (signing out removes both), and only with Settings > Interface > "Answer without a connection" on (off removes the files too). After an update, the first visit with a connection swaps in the new files.

### Fixed

- With no connection, the sign-in check waited for one instead of failing, so a page could stay on its spinner.

## 0.11.1 (2026-09-29): steadier email, and notes for going public

### Fixed

- **No burst of deal messages** when a mailbox is first connected: its first look reads a week of PriceCharting's deal emails, and a message now goes out only for deals from the last 24 hours (older listings have usually sold).
- The mailbox search leaves out a sender or subject left empty in Settings, instead of searching for nothing.

### Added

- **A license for the shipped histories** (`apps/server/data/NOTICE.md`): the console histories and "why it matters" texts that ship with Gamefolio were drafted from Wikipedia, so they're shared under its license (CC BY-SA 4.0), apart from the code (AGPL-3.0); the README credits say so.
- **A design for adding games in Gamefolio itself** (`docs/design/adding-games.md`): to discuss; the roadmap's biggest item.
- Tests for downloading an export (an expired link, a moved one, one too large) and for what the email check says when the mail server can't be found or reached.

## 0.11.0 (2026-09-29): Today

### Added

- **Today** (at the top of the menu; Settings > Interface > Start page can open it first): what matters today on one screen, built for a phone as much as a computer: the game of the day, the three best new deals on games you don't have, what comes out in the next 7 days on your consoles, lent games overdue or due within the week, and how old your collection's last update is (with **Export on PriceCharting** once it's a week old). On a phone it starts with **Scan a game**.

## 0.10.2 (2026-09-29): deals worth a message, and an easier start

### Added

- **Deals worth a message:** Settings > Collection > "Tell me about deals on my wishlist's top" (0, off, by default): a message when a new deal from PriceCharting's emails is on one of your top games here, with its rank, price and listing. PriceCharting emails every deal on its own wishlist; this picks the ones your Gamefolio wishlist ranks highest.
- **An Unraid template** ([docs/unraid/gamefolio.xml](docs/unraid/gamefolio.xml)) until Gamefolio is in Community Applications; the guide says where to save it.

### Changed

- The welcome guide calls IGDB **recommended** instead of optional, and says what happens without it (the wishlist guesses from series names; on the Switch, PlayStation 4 and 5, Xbox One and Series X most games wait as "not confirmed physical").
- The game of the day's "biggest points" are the game's own, never the lines that fit or cap the total ("Fitted to the scale").

## 0.10.1 (2026-09-29): what a new owner sees first

Found by walking through a new owner's install with a made-up collection and no IGDB keys (`scripts/demo.mjs`, below).

### Fixed

- **A console that read 100% complete** when most of its catalog isn't known to be physical: the Nintendo Switch's Wikipedia list mixes in download-only games, and without IGDB 4,383 of its 4,402 games waited as "not confirmed physical", so the 19 owned were all of it. Platforms now says "4,383 not confirmed" beside such a console, with a link to them and what tells them apart (IGDB's keys, a copy on the shelf, It's physical, your own list).
- **A wishlist guessing without saying so:** without IGDB's reviews and genres, scores lean on the series and consoles you collect, so games sharing a name with yours rose to the top ("Mario Paint", "Mario's Early Years! Fun with Letters"). The Wishlist page now says so to its owner, with where the free keys go.

### Added

- **A demo install for screenshots** (`scripts/demo.mjs`): a made-up collection (75 well-known games on 4 consoles), and screenshots of its main pages at computer and phone sizes, for the README, the guide and a video's storyboard.

## 0.10.0 (2026-09-29): deals from PriceCharting's emails

### Added

- **Wishlist > Deals** (D72): PriceCharting emails you when a game of your wishlist there is listed on eBay below the market value. With collection updates from your email on, Gamefolio reads those emails too (the same read-only look, the same sender) and lists the last 7 days' deals: the price and how far below the market value, whether you have the game, and its place on your Gamefolio wishlist, with links to the listing and to PriceCharting. Games on your wishlist come first.
- **The game of the day** gives a game with a fresh deal 15 more points in its draw (a setting), and shows the deal with **See the deal**: the "good value" the old recommender looked for, from PriceCharting's own analysis rather than an AI's.
- The phone check for family credits PriceCharting, with a link, beside what a copy is worth (its terms ask that of anyone showing its prices).

## 0.9.0 (2026-09-29): the game of the day

### Added

- **The game of the day** (the user's idea, for discussion; D71; Settings > Notifications > Game of the day, off until you turn it on): each day, one game you don't have from the top of your wishlist, at the top of the Wishlist page and, if you like, as a message at an hour you choose, with why it's there (its biggest points, and why it matters from its console's history), a link to its price, your preference, and **Another one**. Picked by Gamefolio's own rules, with no AI and no outside service: a draw weighted by score, a few more points for a game that came out around this date in a past year, no repeat of a game for 30 days nor of a series for 5, the same pick all day.

## 0.8.1 (2026-09-29): a guide to install and set up, and a way back in

### Added

- **Install and set up Gamefolio** ([docs/guide](docs/guide/README.md), the user's request): step by step from nothing to daily use: installing on Synology, Unraid, Portainer, TrueNAS, any Linux server or Docker Desktop; the first visit; reaching it from a phone over HTTPS (Tailscale, Cloudflare Tunnel with Access, or a reverse proxy) so the barcode camera works; connecting each service; updates, backups, moving and troubleshooting.
- **Locked out?** `docker exec -it gamefolio node server/dist/reset-link.js` prints a link that works once to choose a new password for the owner (the same kind of link System > Users makes for others). There was no way back in before.

## 0.8.0 (2026-09-28): collection updates from your email

### Added

- **Collection updates from your email** (the user's request, D69; Settings > Features, off until you turn it on): PriceCharting emails a link to your export when you ask for one, and Gamefolio now watches your mailbox for that email and updates your collection from it, with the same safety checks as an upload. It signs in with an app password (the email notifications' account works), looks only at PriceCharting's export emails from the last 7 days, never marks, moves or deletes mail, and downloads only from PriceCharting's storage. **Save and test** under the switch signs in and says what it found; **Collection updates** shows the last look, with **Check now** and **Export on PriceCharting**.
- **Remind me to export** (Settings > Collection > Reminders, off until you set it; D70): a message with PriceCharting's collection page when your newest export is that many days old, once per export.

### Changed

- Each email provider on Settings > Notifications also knows its incoming mail server, for collection updates from email.

## 0.7.2 (2026-09-28): scanning that finds the game, and its price one tap away

### Fixed

- **Scanning a game in Store Mode** (the user's report: about half the scans found nothing). A barcode service names a product with more than its title: a publisher ("Microsoft Halo 5: Guardians"), an edition ("Mafia III Deluxe Edition"), notes in brackets, the console. Gamefolio searched with all of it, so any extra word meant "Nothing found". Now it looks for the game's title inside the name, on the console the name gives first; failing that, that console's games with the name's words, then the ones sharing most of them (D67). Tried on 59 names written the way barcode services write them, against a whole collection: all 59 found the right game, on the right console.
- A UPC read with a zero in front (as some phones read them) is the same barcode as without, so a barcode you linked is known however the camera reads it next time.

### Added

- **Price on PriceCharting** with every game you don't have, in Store Mode and on the phone check for family ("Shopping for them?"). For a scanned game it goes by the barcode, straight to that edition's page. It opens PriceCharting in the browser: Gamefolio doesn't fetch PriceCharting's prices, which their terms keep for their site and paid plans (D68).
- **Store Mode in the header:** a camera button on every page opens Store Mode with the camera on, and **Scan another** under the answers opens it again. Store Mode's icon is a camera.
- **When a barcode finds nothing:** **Search by title** with the name already typed (tap "This is it" on the game, and Gamefolio remembers the barcode), and **Look it up on PriceCharting** (it knows most games' barcodes).
- **A steadier camera:** a sharper picture, refocusing where the phone allows it, the same code read twice before it answers (a misread seldom repeats), a tip about glare, and a **Light** button where the browser can switch the phone's light (Chrome on Android).

## 0.7.1 (2026-09-28): your preference wherever a game you don't have is listed

### Added

- **Your preference everywhere** (the user's request, D66): the picker (🔥 Must Have ... 🚫 Do Not Recommend) now sits with every game you don't have, not only on the wishlist, its drawer, Coming soon and Past releases: a console's page (a "Your preference" column on its missing games and its other tabs; under the title on a phone), the Top 100 and History tabs' Start here games, Platforms > Timeline (as a mark), sets, series, Store Mode's answers and Check a list. A change shows everywhere at once, and the wishlist's scores follow.

## 0.7.0 (2026-09-28): more ways to be told, and email set up for you

### Added

- **Email providers:** Settings > Notifications > Email provider fills in the mail server and port for Gmail, Yahoo Mail, iCloud Mail, AOL Mail, Zoho Mail, Fastmail, GMX and Microsoft 365, with the steps to get the app password each wants. "Another provider" is for any other server. Outlook.com, Hotmail and Live are listed only to say they can't work: Microsoft stopped letting programs send from them with a password in September 2024 (D64).
- **Setup steps with a way out:** each step links to the page it's done on, with "Search the web" beside it for when that page moves; Settings > Interface > Web searches picks Google, DuckDuckGo, Bing or Startpage (D64).
- **More ways to send messages** (D63), each with its own switch: **Pushbullet**, **ntfy** (ntfy.sh or your own server), **Gotify**, **Discord**, **Telegram** (with "Find my chat" for the chat ID), **Slack**, a **webhook** with each message as JSON (for n8n, Home Assistant, Node-RED...), and **Apprise** (which passes messages on to 100+ more services).
- The importance of summaries, held updates and problems now applies to ntfy and Gotify too, and goes with the webhook and Apprise.

### Changed

- A service's fields show under its switch once it's on, so Settings > Notifications stays short (D63).

## 0.6.2 (2026-09-28): Super Rare Games

### Fixed

- **A set from Super Rare Games' Wikipedia page** said the page had no table of games: the page has a table per console, under a heading such as "Nintendo Switch", with no console column. A table's heading now gives its games' console when their rows don't name one.

### Added

- **Ready-made sets:** Sets > New set offers Limited Run Games and Super Rare Games in one click.

## 0.6.1 (2026-09-28): setting up an optional part where you turn it on

### Fixed

- **PC game prices couldn't be set up:** its key's field was on Settings > Sources, which hides a part's settings while the part is off, and the switch said to enter the key first. Now, turning on a part in Settings > Features shows what it needs right under its switch (PC game prices: the key and store country; RomM: its address and token; IGDB: its keys; the PC library: its folder), saved with the page, with a test button (D62). RomM had the same trouble in new installs.
- A page whose settings are hidden because their part is off now says which part, with a link to its switch, and the settings search leads to the switch too.

### Added

- **Test the key** for IsThereAnyDeal, under the key.

## 0.6.0 (2026-09-28): what you played, your copies, share links and the workbook

The first ideas from other collection apps (docs/IDEAS.md), a spreadsheet export with everything, and a license.

### Added

- **What you played:** a status for each game you own (not played yet, playing, beaten, completed, dropped, just for the shelf) and your rating from 1 to 10, in its drawer. **Collection > Backlog** lists your games by status, with **What to play next**, which picks a game from your backlog, leaning toward the ones IGDB rates well. The Collection page filters by it, and the Top 100 lists show it and how many you've finished (D52).
- **Your copies' details:** where each copy is kept, your own tags, and whether it's for sale or trade, from its drawer; the Collection page shows them and filters by them (D54).
- **Loans:** lend a copy to someone with the day it's due back; **Collection > Loans** lists what's out, and a message comes when a game is overdue (D54).
- **Photos of your copies,** made smaller in your browser and kept in Gamefolio's database, so backups have them (D54).
- **Collection > For sale:** the copies you'd sell or trade, with asking prices, a download, and the games you own more than once to choose from (D59).
- **Share links:** a link anyone can open without signing in, to your wishlist's top picks with where to buy them (for gifts), or to your games for sale. One per person, with how often each was opened, and removable (D53).
- **A spreadsheet of your own** works as your collection, for people without PriceCharting: a CSV with a Title and a Console column (D55).
- **PC game prices** (optional, Settings > Features): the PC wishlist shows each game's best price now, how much off, and its lowest ever, from IsThereAnyDeal, with a message when one drops (D56).
- **Collection > Statistics:** the collection counted every way, with bars: by console, value, condition, region, decade, genre, year added, spending and play status, and the most valuable copies (D57).
- **Collection > Report:** every copy by console with values and totals, to print or save as a PDF (D57).
- **Download > Everything (Excel workbook):** one file with a tab for each part: summary, collection, wishlist, missing games, played, loans, for sale, notes, PC library and Top 100 (D58).
- **The license:** Gamefolio is free software under the GNU AGPL v3.0 (D60).
- The dashboard stats (`/api/v1/stats`) add `backlog`, `lent` and `forSale`.

### Changed

- The game drawer names each copy's condition in words ("Complete in box").
- Settings > Features lists share links among what Gamefolio can use.

## 0.5.0 (2026-09-28): help, and ready for testers

The audit's first part: help in the app, a readme for people who've never seen Gamefolio, and tests with no route left out.

### Added

- **Help in the app:** **Help** in the menu, and a **?** beside each page's title that opens its guide: getting started, your collection and Copies, catalogs, how matching works, the wishlist, Store Mode, sets, Top 100 and history, optional parts (with IGDB keys and what leaves your server), the PC library, RomM, sharing, notifications, backups and updates, and what to do when something goes wrong. The same guides are in docs/help for GitHub.
- **Setup asks for the date format,** and a region's usual currency and date format are filled in when you pick it (euros and day/month/year for Europe, say), until you choose otherwise.

### Changed

- The readme is written for someone installing Gamefolio for the first time: what it does, what you need, a compose file, updating, privacy and credits; CONTRIBUTING.md and SECURITY.md are new, and docs/PUBLISHING.md lists what's left before the repository opens to everyone.
- The currency setting says what it does: the export's amounts are shown as they are, never converted.
- Copies' buttons each name their game, for screen readers.

### Tests

- Every API route is now called by a test (revoking an invite, calling off a restore, forgetting a barcode, discarding a held PC reading, the PC wishlist's hidden games, starting a PC search or a RomM update, were missing), with more for Copies and the Top 100. The server's tests cover about 96% of its lines, the core's about 98%.
- The browser walk-through also writes why a game matters, marks a console's history verified, corrects a copy on the Copies page, switches the PC library off and on, and opens a page's guide: 123 checks.

## 0.4.0 (2026-09-28): Top 100 lists, console history, Copies, and parts you can switch off

Each console's best games in ranked order with what you have of them, the history of the consoles, a page for every copy of each game (sealed games you can play another way first), and a switch for every part of Gamefolio that needs something outside it. Everything below is tested and runs on the owner's server.

### Added

- **Top 100 lists** (D48): each console's page has a Top 100 tab: its best games in rank order (a consensus of critics' and retrospective best-of lists, for 45 consoles), each with its cover, year, developer and publisher, why it matters, and what you have of it (owned, with each copy's condition: CIB, sealed, loose...; to review; or not owned, with the other consoles you have it on, a PC copy, its place on your wishlist and your preference). Filter to the ones you own or the ones you don't (a hunting list), or to the ones in RomM; the top says "Own 63 of 100 · 58 of them in RomM". Another region's console of its own counts with its console: a Super Famicom copy counts on the Super Nintendo's list, and the Super Famicom's page has the same list.
- **Console history** (D49): each console's History tab: who made it, its generation, launch days and prices by region, units sold, key hardware, what it competed with, how it did and why, its firsts and its end, with "Start here", a handful of games that show what the console was about. The PlayStation 3 and the Super Nintendo have it all; 52 other consoles have their facts, for now. Every text shows its sources and whether it's a draft (written with Claude's help from Wikipedia) or checked: the owner can mark it verified, rewrite it, or write one for a console that has none, and their version is kept apart from Gamefolio's (and flagged when Gamefolio's changes).
- **Why a game matters:** a sentence or two on the Top 100 tab and in the game's drawer, with its rank ("#1 in the console's Top 100"): for every game of the PlayStation 3's and the Super Nintendo's lists so far. The owner can write one for any game, from its drawer.
- **A timeline** (Platforms > Timeline): the console generations side by side, then year by year, each console's launch and its landmark games (the best of its Top 100, and its Start here games, marked when you have them). How many games per console is a setting (Settings > Interface).
- **Copies** (Collection > Copies, D51): each game you have with every copy of it, on each console and on PC. "Sealed, playable another way" finds the games you keep sealed that you can still play: owned on PC (Steam, GOG...), another copy that's open, or in RomM; "Sealed, no other way", "More than one copy" and "Everything" are the other views. Games are put together by title; a copy's menu says it's the same game as another (a different name) or a different game, and puts it back.
- **Settings > Features** (D50): a switch for each optional part: covers and details from IGDB, the Top 100 lists and history, the PC library (Playnite) and RomM links. Off, a part leaves the menus, its settings hide (keeping their values), its tasks stop and its API answers as if it weren't there. The page also lists the other outside services, each with its own switch (email, Pushover, barcode lookups, catalog sources, the check without signing in). Only a PriceCharting export is required.
- **RomM links for games you don't own** (Settings > Sources > RomM, off by default): the Top 100, Start here and the game drawer can link to RomM for games that aren't in your collection. Gamefolio doesn't endorse piracy: turning it on assumes you own those games.
- **Developers and publishers** from IGDB, for the Top 100 lists (after the next IGDB update).

### Changed

- **New installs start with the PC library and RomM links off** (Settings > Features); an install that already reads Playnite or has RomM's address keeps them on.
- The Collection entry in the menu opens its pages, Collection and Copies, as the Wishlist's does.
- Sets find a game's catalog game by its own title before its other names ("Journey" is Journey, not the first game that also goes by "Journey Collector's Edition").

### Fixed

- After joining through an invite link, a new viewer landed on "Page not found" until they clicked something; now they land on the start page.

## 0.3.0 (2026-09-28): other people, and shopping

Other people can look at the collection, and someone shopping for its owner can check a game without an account. Everything below is tested and runs on the owner's server.

### Added

- **Viewers** (D46, D47): other people can sign in to look at the collection (its games and value, each console's gaps, the wishlist, Coming soon, Past releases, sets and series, and the PC library) but change nothing; the server refuses them anything else. The owner invites them from **System > Users** with a link that works once: they choose a username and password. The same page makes a link for someone to choose a new password, removes a viewer, or hands the collection to another account. What you paid, your notes and the PC library are shared with viewers only if you say so (Settings > Security > Viewers). A viewer's menu has no Settings, System, Review or updates; their account menu changes their password.
- **Check a game without signing in** (D47): when Settings > Security turns it on (off unless you do; on phones and tablets, or everywhere), the sign-in page leads with "Shopping for them?": scan a game's barcode or type its title, and it says whether the collection has it or needs it, with the cover, the wishlist's priority and links to its prices, and what the owner's copy is worth if the owner shows that. A limited number of checks per address, nothing private. On a computer (with "On phones and tablets"), the ordinary sign-in.
- **Past releases** (Wishlist > Past releases): the games that came out around this time of year in each of the last four years on the consoles you collect, since a game a year or more old often costs less than at release. The ones you don't have (or every game), by date or by wishlist score, by console, each with links to its prices. How many years back and how wide "around this time" is are settings (Settings > Interface).
- **Shop links in the drawer:** each game's drawer links to a search for it in the shops you choose (Settings > Interface > Shop links: a name and the shop's search address with {title} and {platform} in it, and optionally the consoles it's for). eBay is there to start with, and Deku Deals (every seller's price) for the Nintendo Switch and Switch 2. Past releases shows them beside PriceCharting's link.
- **The collection as a grid:** Collection > Grid shows each copy as its cover art with its title (a game without art as its title on a plain tile), with the page's filters, sort and pages; List goes back to the table. Each browser remembers the last one.
- **Your preference with a mark, wherever a game is listed:** the wishlist, Coming soon, Past releases and a game's drawer each have the preference picker (Must Have, Do Not Recommend...), and each level has a mark that follows its points: 🔥 your top level, ⭐ the next, 👍 the others above zero, 👎 below zero, 🚫 Do Not Recommend. Settings > Interface > "Your preferences shown as" can make it the mark alone, to take less room.
- **Covers open the game:** clicking a game's cover (Collection, a console's page, the wishlist, Store Mode, Past releases) opens its drawer, as its title does.

## 0.2.0 (2026-09-28): beta candidate

The first version meant for other people to try. Everything below is tested and runs on the owner's server.

### Added

- **A game's page in a drawer:** click a game's title (Collection, a console's page, the wishlist, Sets, Coming soon, Store Mode, a console copy on the PC library, a Review question, or a price move) for everything about it in one place: the console catalog's answer and where it came from, your copies with their value and price paid and how each counts as the game, other consoles and PC storefronts you have it on, your sets, the wishlist's points, and links to its console page, RomM and IGDB. The answers other pages take work there too: "It's physical", "It's a target" or "Not a target", "I bought it" (with Undo), "Same game" or "Different" for a look-alike, "not the same" for a copy counted by a similar title, the wishlist's preference and snooze, and "Add to a set" (or "take out" of one).
- **Find a game from any page:** the search box in the header (press / to jump to it) finds a game on every console with Store Mode's answer beside it, and opens it in the drawer; empty, it lists the games you opened lately (kept in the browser). On a phone the header's search button opens Store Mode.
- **Release reminders:** a message by email and Pushover when games you don't have yet come out on the consoles you collect, on the day or up to 30 days before, each game once for its date (again if the date moves). Games you own, said aren't a target, snoozed or marked Do Not Recommend are left out, and a least wishlist score can leave out more. Off until you turn it on: Settings > Notifications > Release reminders.
- **Store Mode without a connection** (D45): Store Mode keeps a copy of its answers in the browser it opens on (updated each time it opens, downloaded again only when it changed) and answers from it when Gamefolio can't be reached: no signal in a store, no answer within a few seconds, or a Wi-Fi sign-in page answering instead. It says when it does. "I bought it" works there too: the purchase is kept in the browser and counts as soon as Gamefolio answers again (Store Mode lists what's waiting). Saved barcodes work too; notes and new barcodes wait for the connection. Signing out removes the copy, and Settings > Interface > "Answer without a connection" turns it off.
- **Your notes on games:** write a note on any game in its drawer ("Your note": the edition you're after, what to check at a store). Store Mode shows a game's note with its answer, a small mark beside the game's title on every page shows it on hover, and Your notes (from the Collection page or the drawer) lists them all with a search. The wishlist's and the collection's downloads have a "Your note" column. Backups keep them with the rest of the database.
- **A game's summary in its drawer:** IGDB's description of the game, asked for the first time its drawer opens and kept (a whole console's summaries would be megabytes in every backup).
- **Price history:** each copy's value is kept from every collection update that changed it (dated by the export's date in its file name), even after old updates' rows are cleared out. The game drawer shows a copy's value as a small line with its change since the first update, and every value on hover. An install from before starts its history from the updates it still keeps.
- **Dashboard stats:** `GET /api/v1/stats` also gives `valueChange` (since the previous update) and `pricesAsOf` (the export's date), for Homepage and similar start pages.
- **Each console's change in value:** the Platforms page shows under each console's value how much it moved since the previous update (copies added or removed, and prices).
- **The collection as a spreadsheet:** Collection > Download: every copy with its console, region, condition, value, price paid, dates, the catalog game it counts as and its series, as a CSV that Google Sheets or Excel opens as it is. It follows the page's filters: one console, a region, a condition, a search, or the games you own more than once.
- **Spending:** the Collection page shows what your copies cost by the month you bought them (PriceCharting's purchase date, or the day added), the last 12 months by console, and a monthly budget if you set one (Settings > Collection).
- **Coming soon** (Wishlist > Coming soon): the games not out yet on the consoles you collect, soonest first by month, with whether you already have a copy, Game-Key Cards marked, and the wishlist's score. "Calendar file" downloads the dated releases as all-day events for Google Calendar, Outlook or Apple Calendar. The update summary lists the games out in the next 30 days (Settings > Notifications).
- **Series** (Sets > Series): every series IGDB knows that you own a game of, with how many of its games in your consoles' catalogs you have, sorted by the most owned or the fewest missing; open one for its games, the ones you don't have first.
- **Sets** (D41): your own sets of games beyond consoles, such as a publisher's releases (Limited Run Games), a series or any theme. Make one from a Wikipedia list or from a CSV with Title and Platform columns. Each has its completion, a filter by console, its missing and owned games and a download of what's missing. Whether you own a set's game is its console catalog's answer, your review answers included. Store Mode says which sets a game is in, and the wishlist can give a set's missing games points (Wishlist > Scoring, off by default). An owned look-alike of a set's game can be answered ("Same game" or "Not it") on the set's page, games can be added by hand or taken out (kept when the list is read again), and a missing game says which other consoles you have it on.
- **Check a list** (Store Mode > Check a list): paste a store's list or a lot for sale, one game per line with its console if you like ("Chrono Trigger (SNES)"), and see which you own, which you need and which you have on another console. Barcodes work too, one per line, as a handheld scanner types them.
- **PC library** (D37): your PC games from Playnite's library backups, read in place from a mounted folder (the backups' artwork is never copied). Every storefront is in one list, each game shown with how it's owned (owned, subscription, not verified), its playtime and its console copies. An ownership audit settles storefronts that mix in subscription games. A reading that would lose an unusual share of the games waits for your confirmation. "Download" there gives the games it shows as a spreadsheet (storefronts and how each counts, playtime, console copies), like the old PC Library tab.
- **Owned on PC** (D38): a console game you own on PC shows a PC badge on its console page, "You have it on PC" in Store Mode, and its own line on the wishlist. It never counts as owning the console game.
- **PC wishlist** (D39): PC games worth buying, found through IGDB: the genres you like, the series you collect, and the PC versions of console games you keep sealed. They're ranked with Steam's review scores, and everything you own on PC is left out.
- **Health checks for the PC library:** a Playnite folder that went empty or whose newest backup is old shows on System > Status and sends an alert. A held reading sends a message, and the dashboard stats (`GET /api/v1/stats`) include PC games.
- **Region-locked consoles** (D32): on consoles that can't play other regions' games, copies from other regions are consoles of their own (the Super Famicom beside the Super Nintendo), each with its own catalog and completion.
- **Catalog sources in your order** (D35, D36): Settings > Sources lists where catalogs come from (your lists, Nintendo Life, Wikipedia), most trusted first. When sources disagree, the higher one wins and the console's page shows the difference. A source can be trusted first for one fact, such as release dates.
- **Upcoming games and Game-Key Cards** (D33): whether games not out yet count as missing, and whether Nintendo Switch 2 Game-Key Cards count. Both are settings.
- **Japanese titles romanized differently** (D40): on consoles of Japan's own, "Jikkyou" and "Jikkyō" (long vowels, n or m, "wo" or "o") are the same title. Elsewhere such pairs are Review questions, and Store Mode finds a title typed either way.
- **Titles without their subtitle** (D42): a setting, off by default, that counts "Doraemon 2" as "Doraemon 2: Nobita no Toys Land Daibouken" when exactly one catalog game fits.
- **Review by reason:** the look-alikes can be filtered by why they look alike (one title contains the other, romanized differently...), with the reason shown on each, and a filtered list answered "Same game" at once where each question has one suggestion (after a confirmation with examples).
- **How matching works, in the app:** a page on when a copy counts for a catalog game and what to do when one is counted wrong, linked from Review and every game's drawer.
- **Welcome guide, wishlist step:** put the consoles and genres the wishlist learned from your collection in your own order, and pick the styles you like.
- **Wishlist scores fit the scale** (D43): when a collection's top ten land far from 90 to 100 (a new owner's tastes add up differently), every score is multiplied so the tenth best lands at 90, shown as its own line in each score; the order never changes. Wishlist > Scoring > "Fit scores to the scale" turns it off (an install updated from 0.1.0 may want to: it can move scores you tuned); the place it looks at and where that game lands are settings too.
- **Ownership for other tools:** `POST /api/v1/owned` answers for up to 100 games at once (or `GET /api/v1/owned?title=` for one) whether each is owned, on which consoles and PC storefronts, with the same title rules as the catalogs, for a recommender or any automation (docs/API.md).
- **What's new:** after an update, the first visit shows what the new version brought (from this changelog), once; System > Status shows it again.
- **Support file:** System > Status > "Support file" downloads what someone helping with a problem needs: the version, health, settings (never passwords or keys), recent tasks and log lines.
- **Second backup folder:** Settings > Storage copies each backup to another folder, such as a NAS share.
- **A warning before the disk fills up:** System > Status (and the health check's alerts) warn when the disk with the database or its backups has less room than a few more copies of the database (at least 500 MB).

### Changed

- Easier to read and to use with a screen reader: gray text, links and badges have enough contrast on every background, in dark and light mode, links are underlined, and every button, field and progress bar has a name. Checked with axe-core on every page in both modes, now part of CI.
- The web interface loads each page the first time it's opened and its files are sent compressed (about a quarter of their size), so Store Mode on a phone starts faster. A page left open over an update reloads itself once.
- Sets, Store Mode's search and Review answer faster (sets about 20 times, search about 3 times on the owner's server).
- Release dates show as precisely as the source gives them ("2026", "Oct 2026").

### Fixed

- A task that a restart (an update, say) interrupted waited for its next regular time, a month for the catalog build. It runs again two minutes after Gamefolio starts.
- A game's drawer showed its wishlist points only when the game was in its console's top 20. Every missing game shows them now, and a game kept off the wishlist says why (hidden, a price limit, a preference, its release class, a Review question).
- Store Mode, the search and the consoles' pages showed a top pick's master-list score (its score less the wishlist's variety penalties, which only order that list and can fall below 0) instead of its own score. They show its own score now, with its place on the list.
- Zelda games as PriceCharting writes them ("Zelda Twilight Princess") didn't count as the catalogs' "The Legend of Zelda: Twilight Princess"; they were Review questions, and Store Mode could call a Zelda game you own needed. They're the same title now (D44).
- The collection's value over time and the biggest price moves were dated by when each export was imported, so an export imported late looked like a change on the import day. They go by the export's date now (from PriceCharting's file name).
- A page that failed to draw left a blank screen. Now it says so, with Reload and a support file to download, while the menu keeps working, and the problem goes into the log (so into the support file too).
- A list's Release column kept any text as a date ("Game Cartridge"); only dates and words such as "TBA" count now.
- The PC wishlist's search looked up only the first 150 sealed console games by title, the same ones every week. Now it looks up every sealed game once and remembers each for a month.
- Two backups made in the same second could share a name, so the newer one could be removed right away.
- A folder Gamefolio only reads (the watched folder when files stay put) said "isn't writable" when it couldn't be read.

## 0.1.0 (2026-09-27): first version

Deployed on the owner's server on 2026-09-27, replacing the n8n and Google Sheets system's console workflows (D34).

- Collection updates from PriceCharting's export (the CSV or its zip, uploaded or dropped into a watched folder), with safety checks, held updates, reports of what was added and removed, and history. The collection's value over time.
- Catalogs for each tracked console, built from Wikipedia's lists with your own lists on top, physical releases first (D24 to D26). Also: completion, review of look-alike titles, ownership mappings, and owned games outside the catalog to link, add or ignore.
- The wishlist, with every point explained on a 0 to 100 scale (D30). Its Scoring page lets each ranked list follow a curve.
- Store Mode for phones: title search or barcode scan, "Need it", "You own this" and "I bought it".
- Covers and game details from IGDB, links to your RomM, and notifications by email or Pushover.
- A welcome guide, settings pages generated from one list of settings, background tasks, backups with restore, logs, a health check, and an API (`docs/API.md`).
