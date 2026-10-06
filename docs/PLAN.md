# Squirrelcade plan

The plan of record: what Squirrelcade is, the decisions behind it, its architecture and its phases. It started as the 2026-09-27 draft the user agreed to and is kept current; what each version built is in `../CHANGELOG.md`, and each decision with its reasons in `DECISIONS.md`.

## What Squirrelcade is

A self-hosted web app, run as one Docker container, for managing a video game collection: what you own, what each console's library still lacks, what to buy next and why, and whether the game in your hand at a store is one you need. It takes over from the n8n and Google Sheets setup, keeps the rules that setup got right, and drops the machinery that made it fragile. It looks and works like Sonarr, Radarr or RomM: everything in the browser, settings in the app, background tasks you can see and run.

## Decisions

| Decision | Choice | Date |
| --- | --- | --- |
| Master copy of the data | Squirrelcade's own database, built from the PriceCharting export and public sources. The old workbook isn't imported (D24); it stays a read-only archive. An export back to Sheets can come later. This replaces ChatGPT's earlier rule that the Sheet is the authority. | 2026-09-27 |
| Recording purchases | Squirrelcade is the hub of the owner's collecting (2026-09-29): it keeps every copy (0.19.0, D81), updated from PriceCharting's export (the CSV, or the collection.zip it arrives in), a spreadsheet of the owner's own (0.6.0, D55) or another app's export (0.15.0). Adding games in Squirrelcade, and sending them to PriceCharting and the other services, come next ([design](design/adding-games.md)). Before 0.19.0, PriceCharting was where purchases were recorded and each export replaced the collection. | 2026-09-29 |
| License | GNU AGPL v3.0 only (D60). | 2026-09-28 |
| PriceCharting | The user has the Collector plan: unlimited collection exports, but no API and no price-guide downloads. Squirrelcade is built on the export; PriceCharting's API (Legendary plan only) isn't part of any roadmap (the owner, 2026-09-29: Squirrelcade's users won't have it). | 2026-09-29 |
| First version | Consoles first: collection, per-console completion and gaps, the scored wishlist. Then Store Mode, the PC library and notifications. | 2026-09-27 |
| Old system | Stays parked and untouched until Squirrelcade replaces it, then is retired with the user's OK. | 2026-09-27 |
| Settings | Every decision is a setting, in a full settings area like Sonarr's. Squirrelcade is built around the user's preferences, but they're stored as that install's settings, not written into the code, so anyone can tune it to their own collection. | 2026-09-27 |
| Tech stack | TypeScript: Fastify, SQLite with Drizzle, React with Vite and Mantine (see "Architecture", D03). | 2026-09-27 |

## Principles

- **Exact ownership.** Platform, region, edition and format stay distinct. Ownership elsewhere (another console, a PC storefront) is shown as related, never counted as the same thing.
- **No guessing.** Aliases and compilations come from reviewed mappings. Anything uncertain goes to a review queue rather than being silently matched or silently missed.
- **The user's decisions are durable.** Rules, overrides, exclusions, mappings and curated game details are never overwritten by a refresh.
- **Every recommendation explains itself**, point by point.
- **All or nothing.** Each refresh runs in a database transaction: it either completes or changes nothing. No half-finished runs.
- **Outside sources fail soft.** A source that's down or returns nothing never wipes the last good data.
- **Every decision is a setting.** Tastes, consoles, regions, rules, points, list sizes, schedules, limits, folders and keys all live in the settings pages with a description and a default. Nothing about one person's collection is written into the code, so anyone can install Squirrelcade and tune it.
- **Only a collection is required.** Everything that relies on another program or an outside service (IGDB, Playnite, IsThereAnyDeal, RomM, email, Pushover, barcode lookups, catalog sources) is optional and has a switch; Settings > Features lists them (D50).

## Architecture

**One container**, like Sonarr: a web interface, an HTTP API, a background task runner, and a SQLite database. Folders mounted from the host:

| Mount | Purpose |
| --- | --- |
| `/config` | Database, settings, logs, automatic backups |
| `/imports` | Optional watched folder for PriceCharting exports (the CSV or its zip) |
| `/playnite` | Playnite backup folder, read-only (the PC library, D37; optional) |

**Stack:** TypeScript throughout.

- Server: Node.js with Fastify, SQLite through Drizzle ORM (typed queries and migrations).
- Web: React with Vite and Mantine, a component library suited to dense tables and forms. Installable on a phone's home screen.
- Shared core package: the pure domain logic (matching, eligibility, scoring, wishlist selection) with its tests, used by the server and runnable on its own.
- Playnite (phase 5): keep the existing C# reader (read-only LiteDB), built into the image as a helper program.

Why TypeScript: the old system's tested logic (scoring engine, wishlist selector, PC ownership rules, email formatter) is JavaScript with test files, so it can be carried over with its tests instead of rewritten. One language covers the server and the web interface.

**Tasks.** A tasks page lists every scheduled job with its last result and next run, and a button to run it now (as in Sonarr). Jobs of the same kind never overlap. Every run is logged.

**API.** The web interface uses the same documented API that other tools can call, for example a read-only "do I own this?" check for the daily deal recommender.

**Access.** Login inside the app plus an API key for integrations. From outside the home, access goes through Cloudflare Tunnel and Cloudflare Access, the same pattern as the user's other self-hosted services, so Store Mode works in a store.

**Secrets** (IGDB keys, the mailbox and SMTP passwords, the messaging services' tokens, the RomM, IsThereAnyDeal, barcode and achievement services' keys and tokens) are typed into Squirrelcade's settings by the user, and never leave the server: a settings export, the support file and the AI-assisted setup prompt leave them out. Never in git, never in chat.

**Build and deploy.** GitHub Actions tests every push and builds the image; the "Publish image" workflow, started by hand, publishes it to the GitHub Container Registry (private for now, D19). The home Docker server runs it with Docker Compose and picks up a newly published image overnight, checking its health and counts and rolling back if either fails. Docker isn't installed on the development PC, so images are built in CI; local development runs Node directly.

## Settings

Settings are organized in pages like Sonarr's. A new install starts from neutral defaults: the first-run setup asks for the account, home region, currency and time zone, and a welcome guide takes the PriceCharting export, which consoles to track, the catalogs (with the user's own lists, if any) and the IGDB keys. The owner's choices from the old system came over as their install's settings (the wishlist points as a settings file made from the old Scoring Matrix). Every setting has a description, a default and a reset; less common ones sit behind a "Show advanced" switch; invalid values are rejected with a reason. All settings can be exported to a file and imported again, to back up or share a setup.

| Page | What it covers |
| --- | --- |
| General | Instance name, time zone, currency, home region, date format, update checks |
| Interface | Theme, cover art, table density, region badges on owned copies (other regions than home by default), start page, the header search's size, shop links in the game drawer, Store Mode without a connection, Past releases' years and window, how preferences show (mark and name, or the mark alone) |
| Collection | Collection updates (browser upload, the watched folder and its file-name patterns, how often it's checked, when an update is held); how PriceCharting console names map to platforms and regions; how condition and included-items text maps to box, manual and sealed |
| Platforms | Eligibility threshold (more than five unique games by default); which consoles are region-locked (there, other regions' copies are consoles of their own, such as the Super Famicom; D32); per platform: on or off, display name, catalog source and refresh schedule, priority, completion campaign; labels that never count as a console (PC) |
| Catalogs and matching | Where catalogs come from (Wikipedia's pages, what Wikipedia adds under the user's own list, refresh interval); physical-release evidence (consoles whose lists mix in downloads, IGDB's regions, download titles); what counts as a target (editions, other regions, unlicensed and homebrew); when a match goes to review |
| Wishlist > Scoring (under the wishlist, not Settings) | A 0 to 100 scale (D30): points by platform and by genre learned from the collection until the user sets their own, reviews from IGDB (trusted once enough people rated), a series you collect. Each ranked points list (consoles, genres, styles, interest levels...) follows a shape the user picks (a straight line, exponential, logarithmic or three steps between its top and bottom points) or the user's own numbers, on a chart whose entries can be dragged along the line. Tastes: console order, genre ranking, liked and disliked styles. Every scoring component and its points: series, region, completion tiers, personal interest, release class, platform significance, market urgency, tie-ins, owned on another platform. List sizes and per-console caps, diversity penalties, priority bands, buying preferences (preferred condition, requiring the manual in used copies) |
| PC library | Playnite backup folder and safety checks; storefronts and their ownership types; PC wishlist size, discovery sources, review-quality and sealed-copy points |
| Sources | The catalog sources in the order they're trusted, each on or off, with what each gives, where it applies, its terms and its last reading (D35), and which source to trust first for release dates and for formats (D36); IGDB keys (with a connection test right under them), RomM, the barcode lookup service; later Steam; each fails soft |
| Tasks | Schedule of each job, quiet hours, retries and backoff, rate limits |
| Notifications | Email and Pushover; which events notify (collection updates, updates held or refused, problems); what the update summary includes; release reminders (on or off, how many days early, the least wishlist score); the Pushover priority of each kind of message |
| Storage and backups | The watched folder and the backup folder (chosen from the container's mounted folders); backup schedule and retention; restore |
| Security | Login method, username and password, API key, trusted proxies (Cloudflare), session length |
| System | Status, health checks, logs and log level, task history, version |

Settings are stored in the database, so every backup includes them. Docker-level settings (port, mounted folders, user and group IDs, time zone) come from the Compose file, as with the *arr apps.

## Data sources

The user has PriceCharting's Collector plan: unlimited collection exports, but no API and no price-guide downloads (both need the $49/month Legendary plan). PriceCharting's terms also bar using its price data in software other people use without written permission, so a public Squirrelcade can't ship PriceCharting data or a reader for its pages; each user brings their own export. More generally, sources are used through official APIs or exports where those exist, and any source that reads public web pages is optional, low-volume, and checked against the site's terms before a public release.

| Source | Used for | Notes |
| --- | --- | --- |
| PriceCharting collection export (CSV) | The collection, and the current value of each owned copy | Columns include product `id`, name, console, condition, included items, current value, price paid, purchase date. The `id` is PriceCharting's product ID, shared by copies of the same product. |
| Wikipedia's "List of … games" pages | Each console's catalog: the games released and in which regions; some lists also mark download-only games or download titles (Xbox Live Arcade), and for lists that don't mark them all, the linked articles' categories do (PlayStation Network games) | Read through the MediaWiki API with an identifying User-Agent, about one request a second, refreshed monthly. The newest source for new releases. |
| Your own lists (CSV) | A console's catalog where you have a better list than the automatic sources | Optional; first in the default order of catalog sources (D35). |
| Nintendo Life's Switch 2 lists | Which Switch 2 physical releases are Game-Key Cards and which have the full game on the card (officially confirmed only), with dates | Off by default: their terms allow personal, non-commercial use, so it's on only where the owner turns it on; read at most once a day, identified as Squirrelcade (D35). |
| PriceCharting API | Prices, barcodes and product details, and adding to a collection, for people on the $49/month Legendary plan | Not planned (the owner, 2026-09-29: Squirrelcade's users won't have that plan). |
| IGDB (free, Twitch developer keys) | Genres, themes, series and franchises, alternative names, release dates by platform and region, developer, cover art, ratings; physical-release markers (from retail listings) | Fills most of the game details that ChatGPT curated by hand. Its alternative names tie the other sources and the collection together. The NES and Super Nintendo lists also take in IGDB's Famicom and Super Famicom, which it keeps apart (D28). |
| Barcode lookup service (such as UPCitemdb's free tier) | Store Mode: naming a barcode Squirrelcade doesn't know yet | Optional. The user confirms the game once and Squirrelcade remembers the barcode. |
| IsThereAnyDeal (free API key) | The PC wishlist's prices: the best now among the stores, and the lowest ever (D56) | Optional part, off by default. Asked about the PC wishlist's games only, daily. |
| A spreadsheet of the owner's own (CSV) | The collection, for people without PriceCharting (D55) | Title and Console columns; values are only as current as the sheet. |
| Steam public store | PC discovery and review scores | No login. |
| The user's RomM (optional) | Links from owned games to the same game in RomM, to open or play it | Read-only API token; an index of the ROMs on the RomM platforms Squirrelcade's platforms map to, read nightly (D27). |
| Playnite backups | PC library | Read-only. |

**Physical releases first.** A catalog game counts toward completion, the wishlist and Store Mode's "you need this" only with evidence of a physical release: it's on the user's own list, IGDB has a physical listing for it, it's on a console whose Wikipedia list covers retail games only and Wikipedia doesn't mark it as a download title, the user owns it, or the user confirmed it. Other games a list names show as "not confirmed physical": visible, one click to confirm, not counted. (Platform holders' own sites can't be used: their stores sell downloads, and Nintendo's terms bar automated access. Single publishers' lists such as Limited Run's are left to Collections, below.)

**Match once, then by ID.** The old gap analysis matched titles on every run, and title mismatches caused false "missing" results and duplicate purchases. Squirrelcade stores every confirmed link between a catalog entry and a PriceCharting product ID, so each product is matched once and later imports match by ID. The old system didn't keep such links (it matched titles on every run), so the first matches come from exact titles, PriceCharting edition names, the reviewed mappings and the user's answers to review questions. A look-alike title only gets a suggested match, which goes through review.

## Data model (first cut)

- **Platform:** a console family, with the PriceCharting console labels that map to it (region included) and computed eligibility (more than five unique games owned). On a region-locked console, each other region is a platform of its own (Super Famicom, "Nintendo 64 (Japan)") that reads its base console's sources: Wikipedia list, IGDB and RomM platforms (D32).
- **Game:** a canonical game across platforms (for cross-console ownership and PC overlap), linked to IGDB when matched.
- **Release:** one specific product: platform, region, edition, format, PriceCharting ID, barcodes, release date. A compilation release contains several games.
- **Owned copy:** built (0.19.0, D81, D82) as `copies`: one row per copy owned, kept by Squirrelcade, with a key that never changes (what its details, loans and photos are kept under), its release (PriceCharting's product id, or one Squirrelcade made), condition, included items, sealed or not, value, price paid, purchase date, notes, whose files keep it up to date (`source`: pricecharting, spreadsheet or squirrelcade), the fields the owner changed here (which files don't overwrite), when it was last in its file, since when its file no longer has it (it waits on Review), and when and why it left (sold, removed, gone). The updates' own rows (`collection_items`) stay as they came, for comparing updates, the price history and the value over time.
- **Catalog target:** a release a platform's collection aims to include, with target status (required, optional, excluded) and provenance.
- **Mapping:** a reviewed rule that an owned release satisfies a target (compilation component, edition alias, title alias), with review status.
- **Game details:** genre, style, series, tie-in, offbeat, significance, market urgency and so on, each with a source (IGDB, user, inferred) and confidence.
- **Price observation:** a dated price from a named source, kept separate from ownership. Built (2026-09-28) as price points: each owned product's value in one condition at every collection update that changed it, dated by the export (`price_points`), kept when old updates' rows are pruned.
- **Set:** the owner's named set beyond consoles (a publisher, a theme), from a Wikipedia list or a CSV, with hand edits and look-alike answers (D41). A **series** isn't stored: it's IGDB's franchise for each catalog game, grouped on the fly (Sets > Series).
- **IGDB summary:** a game's description, asked of IGDB the first time its drawer opens and kept (`igdb_summaries`).
- **Settings:** everything on the settings pages, versioned so an export records which app version wrote it.
- **Owner decisions:** per-game preference and score modifier, notes, exclude, hide, defer until a date, report only below a price. Notes are built (2026-09-28) as `game_notes`: one per game on a console, under the catalog's title, shown in the drawer, Store Mode and Your notes.
- **Play status** (0.6.0, D52): `play_status`, one per game on a console under the catalog's title: a status, a rating from 1 to 10, the days started and finished.
- **Copy details** (0.6.0, D54): per copy, by its key (a product in one condition, `<product id>|<include string>`, until 0.19.0; since then each copy's own key, the older keys kept by the first copy of each): `copy_details` (place, tags, for sale or trade, asking price, note), `loans` (to whom, from, due, returned, reminded), `copy_photos` (JPEG, PNG or WebP kept in the database).
- **Share links** (0.6.0, D53): `share_links`, a token per link to the wishlist or the games for sale, with a name and how often it was opened.
- **PC prices** (0.6.0, D56): `pc_prices`, IsThereAnyDeal's id and prices for each PC wishlist game, and the price last told about.
- **PC entitlement** (built with the PC library, D37): one record per storefront, with ownership type (permanent, subscription, historical) and link to a game.
- **Wishlist snapshot:** the ranked list after each refresh, so changes (new entries, drops, big movers) can be reported.
- **Collection updates, tasks and run history.**

## Phases

Each phase ends with something the user can use, with tests, deployed on the home server. Each phase also adds the settings pages for what it builds.

0. **Foundations** (done). Repo layout, CI image build, deployment on the home server, login, tasks page, logs, automatic database backups. The settings framework (storage, validation, defaults, export and import) with the General, Interface, Security, Storage and backups, and System pages.
1. **Collection** (done). First-run setup and a welcome guide. Collection updates from the PriceCharting export (the CSV or its zip, uploaded in the browser or saved into the watched folder) that report additions and removals. (A one-time import of the old workbook was built, then removed: Squirrelcade starts from the CSV alone, D24.) Collection browser with filters, per-console counts and value. After this phase, and with the user's OK, the old n8n import stops watching Google Drive.
2. **Catalogs and completion** (done). Console eligibility; catalogs built from Wikipedia and IGDB with the user's own lists on top, refreshed monthly, physical releases first (D24 to D26); owned games that match no catalog entry listed for the user to link, add or ignore; matching that remembers confirmed links, with reviewed mappings and a review queue; a completion page per console (owned, missing, needs review, percent complete). Exclusions and hidden games.
3. **Wishlist** (done). Game details from IGDB plus the user's curated values; rules and scoring as editable settings; the scoring engine carried over with its tests; the master list and per-console lists with point-by-point explanations; owner decisions; change tracking between refreshes. Compared against the last good n8n wishlist, with every difference explained.
4. **Store Mode** (done). Phone barcode scanning that answers Needed, Owned (exact release), Owned on another platform or storefront, or Unknown; shows score, rank and, for owned copies, their value from the latest export; manual search as fallback. An unknown barcode can be named through a barcode lookup service; the user confirms the game once and Squirrelcade remembers the barcode. Since 2026-09-28 it also answers without a connection, from a copy of its answers kept in the browser (D45).
5. **PC library** (in progress, D37). Done: Playnite's library read from its backups by the reader (built into the image, run on the newest backup in the mounted folder, daily check), one record per game per storefront, ownership types with storefront defaults and the audit (a CSV like the old tab, or one game at a time), the PC library page with the console copies of each game (the ownership matrix), sealed console games not owned on PC, a held reading when too many games would disappear. Owned-on-PC notes on console pages, the wishlist and Store Mode (D38). The PC wishlist (D39): games found through IGDB (genres, series, sealed console games), Steam review summaries, the console wishlist's points plus sealed-copy and subscription points, weekly. PC game prices from IsThereAnyDeal, and Steam achievements beside each Steam game (0.28.0, D92). The side-by-side with the old system's PC Wishlist tab is done (private/compare); next: the owner's look, then retiring the n8n PC Library workflows (with the owner's OK).
6. **Notifications** (done). The additions-first update summary by email (providers filled in, D64), Pushover, Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, a JSON webhook or Apprise (D63), with an importance per kind of message, alerts for held or refused updates and failed tasks. Scheduled refreshes and health checks. Since 2026-09-28, release reminders too (off by default): a message when games not yet owned come out on the consoles collected, on the day or some days before, each game once for its date.
7. **Switch over** (done 2026-09-27, D34). Squirrelcade runs on the home server with the user's collection; the side-by-side check is done (D31) and its policy questions are answered (the Super Famicom as a console of its own, D32; editions, D22; upcoming games and Game-Key Cards, D33). The n8n console workflows are archived, exported first. The PC library's workflows, the Playnite reader and the Sheets stay until phase 5.

**Done: the wishlist, second pass (D30).** Reviews from IGDB, genres averaged, the series you collect, and consoles and genres learned from the collection, on a 0 to 100 scale tuned so the top ten land between 90 and 100. What was found and planned:  On the server the wishlist ties too much. IGDB lists several genres for a game and Squirrelcade takes the first in a fixed order that starts with RPG, so every game IGDB also tags as an RPG counts as one (the user's top genre), and without the old system's curated details little else tells games apart: the 20 Switch picks all scored 61 and sorted by title. The pass: the consoles the wishlist picks from become a setting (the user collects some consoles now, not all 24); a game's IGDB genres count together instead of RPG first; IGDB's ratings break ties (never the title) and, if the user wants, add points; then the comparison with the old system's last wishlist, and the user's sign-off. (Ranked "Top 100" lists were designed here, moved out of Squirrelcade (D29), and came back as a part of their own in 0.4.0, D48.)

**Done, first part: a wishlist step in the welcome guide** (the user's idea, 2026-09-27; built 2026-09-27 night). After IGDB, the guide shows the consoles and genres the wishlist learned from the collection and lets people put them in their own order (up, down, off the list, add); saving makes those lists theirs, on the same curves as Wishlist > Scoring, and shows the new top picks. Styles can be picked there too. Done since (D43, 2026-09-28): when a collection's top ten land far from the scale (the tenth best below 85% or above 100% of the highest score), every score is multiplied so the tenth best lands at 90%, as a line of its own in each score; Wishlist > Scoring > "Fit scores to the scale" turns it off. Still to come, if testers need it: a steadier fall down the list.

**Done: Sets (D41).** The user's own named sets beyond consoles (a publisher such as Limited Run Games, Super Rare Games or Fangamer, a series, any theme), each from a CSV or a Wikipedia list page, with its own completion; ownership is the console catalogs' answer. Store Mode names a game's sets and finds a set's missing games outside console catalogs; the wishlist can give a set's missing games points (Wishlist > Scoring, 0 by default). A look-alike can be answered on the set's page ("Same game" or "Not it"), and games can be added by hand or taken out; both survive reading the list again.

**Done: price history and a budget** (2026-09-28). Each copy's value at every update that changed it, kept past the pruning of old updates' rows and shown in the game drawer; spending by month with a monthly budget on the Collection page.

**Open issue: naming barcodes without an outside service** ([issue 1](https://github.com/squirrelcade/squirrelcade/issues/1), 2026-09-29): UPCitemdb allows 100 lookups a day and 6 a minute, and no open video game barcode database exists. 0.14.0 keeps every name for good and paces lookups (D76); barcodes from other apps' exports came with 0.15.0 (D77), and scan my shelf with 0.33.0 (D97); next, a shared open barcode list once public, and a separate barcode database project.

**Done: value by platform over time** (0.13.0, D75, 2026-09-29): each update keeps its platforms' totals; Collection > Statistics charts the 12 most valuable.

**Done: Squirrelcade keeps the collection** (0.19.0, D81, D82, 2026-09-29): each copy a record of its own; an update updates the copies instead of replacing the collection, and a copy it no longer has waits on Review.

**Done: adding games in Squirrelcade itself** (0.20.0, D83, 2026-09-29; [docs/design/adding-games.md](design/adding-games.md)): Squirrelcade is where games are entered (Add a copy, and "I bought it" adds a real copy); copies added here go to PriceCharting through its paste importer (any account; one import and one export a week on a free one) from Collection updates > Send to PriceCharting, and its export brings their prices back to the same copies. Copies can be changed (condition, price paid, day, notes) and sold or removed; what's changed here is the owner's. Next, **Squirrelcade as a hub**: sends to CLZ Games too (the other collection service with a documented importer), and play logs' exports (Grouvee, HowLongToBeat, Infinite Backlog) read into What you played. **Not planned:** PriceCharting's API, which needs its $49/month Legendary plan that Squirrelcade's users won't have (the owner, 2026-09-29).

**Done: looking after copies** (0.21.0, D84, 2026-09-29, the owner's ideas): a tested log on each copy; standard photos by what a copy has and its console's media (a disc game's box front, back and inside and the disc's two sides; a cartridge's front and back); an estimated price of the owner's for a copy whose price they don't know, with a Suggest button (empty unless they fill it in: D85), for their own sense of what they spent only (never sent to another service or written into an export); and Collection > Improve, what copies are missing, filled in one at a time.

**Done: achievements from Xbox and PlayStation** (0.24.0, D88, 2026-09-29): Xbox's through OpenXBL (a free key), PlayStation's through the PlayStation App's API (psn-api; unofficial, opt-in, a token from the owner's browser that lasts about two months); each game's progress in its drawer, on the console the owner has a copy on, and optionally Completed in What you played. Steam's followed in 0.28.0 (D92: the PC library's Steam games, with the owner's free Web API key). **Next:** the CLZ send and play logs' exports are on hold (the owner doesn't use those services, 2026-09-30).

**Done: settings an AI can write** (0.31.0, D95, 2026-09-30): the setup prompt has the AI write the chosen settings as a file for Settings > Import (no secrets), whose window lists each change before it's applied.

**Done: one in, one out** (0.30.0, D94, 2026-09-30): at or over the goal, a copy added says so, with Sales for what to sell.

**Done: AI-assisted setup** (0.29.0, D93, 2026-09-30, the owner's idea): Help's first page gives a prompt for the owner's own AI (Claude, ChatGPT...), made for their install (what's set up, a link to each setting; never a secret), so it can interview them, plan, and take them through installing and connecting everything one step at a time. The same prompt is in the repository for an install that isn't there yet.

**Done: services and tools in Help** (0.27.0, D91, 2026-09-30): one page with every outside service, program and tool, linked to its official site, with what it needs, costs and where it's set up; a test keeps it complete.

**Done: ripped where a PC can rip** (0.26.0, D90, 2026-09-30): the Ripped record is offered on the consoles whose discs a Blu-ray drive with OmniDrive firmware and redumper can dump (PlayStation 1 to 5, the Xbox consoles, GameCube, Wii, Wii U, Sega CD, Saturn, 3DO); other consoles can be added.

**Done: worth more lately** (0.25.0, D89, 2026-09-29): Sales' suggestions include the copies whose value rose the most since about a year ago, to sell while the price is up.

**Done: a goal for the collection** (0.23.0, D87, 2026-09-29): how many copies or games the owner means to have, with the last 12 months' pace and when it gets there, on Today and Statistics; at the goal, how many are over it.

**Done: selling** (0.22.0, D86, 2026-09-29, the owner's plan to play a game and then sell it for a lunch): Ready to sell writes a copy's listing for eBay or Mercari (title, description, item specifics, condition), with its price after the marketplace's fees and shipping, its sold listings, and its photos (the standard ones still to take, and a zip). A Ripped record for the consoles whose games are ripped puts a full read of the disc in the listing. Collection > Sales counts each sale in money and in meals, and suggests what to sell next (games finished, extra copies). Nothing is posted for the owner. **Later, if wanted:** a bulk file for eBay's File Exchange or Seller Hub reports (many listings at once), Facebook Marketplace and other services, and listing through eBay's API (it needs a developer account and the owner's sign-in).

**Done: Squirrelcade opens with no signal** (0.12.0, D73, 2026-09-29): a service worker keeps the app's files on the phone, and the last sign-in stands in while Store Mode's copy is there.

**Done: Today** (0.11.0, 2026-09-29): one screen for the day (the game of the day, deals, this week's releases, loans due, the last update's age), a start page to choose.

**Done: deals from PriceCharting's emails** (0.10.0, D72, 2026-09-29): Wishlist > Deals, PriceCharting's eBay deal alerts matched to the catalogs and the wishlist, and the game of the day's "good value".

**Done: a game of the day without AI** (0.9.0, D71, 2026-09-29): one wishlist game a day, weighted by score with anniversary points and cooldowns, on the Wishlist page and as a message. Live deal research (the ChatGPT/Claude recommender's job) needs a price source or an AI, both open questions.

**Done: collection updates from your email** (0.8.0, D69, D70, the user's request, 2026-09-28): PriceCharting's export email picked up from the mailbox (read-only, app password) and applied like an upload; a reminder to export. PriceCharting has no export API and can't be driven for the owner, so asking for the export stays a tap on PriceCharting.

**Done: scanning that finds the game** (0.7.2, D67, D68, the user's report, 2026-09-28): a barcode service's name is matched as the game inside it, on the console it gives first; prices of games you don't own are PriceCharting links (by barcode for a scanned game); Store Mode in the header, Scan another, a steadier camera.

**Done: your preference wherever a game you don't have is listed** (0.7.1, D66, the user's request, 2026-09-28): consoles' pages, Top 100 and history, the timeline, sets, series, Store Mode and Check a list, beside the wishlist, the drawer, Coming soon and Past releases.

**Done: an ownership API** (2026-09-28) for the Game of the Day recommender, whose false recommendations came from inexact ownership checks: `POST /api/v1/owned` answers for up to 100 titles at once, with the catalogs' title rules (docs/API.md).

**Done overnight 2026-09-28** (beta candidate 0.2.0): one view of each game (the game drawer, from any title or the header search) that answers the questions other pages take; your notes on games; Store Mode without a connection (D45); price history; the collection as a spreadsheet; Sets > Series; Store Mode > Check a list; a calendar file of the coming releases; the ownership API for other tools; accessibility; a browser walk-through in CI. See CHANGELOG.md.

**Done: Past releases** (2026-09-28, the user's idea): Wishlist > Past releases lists the games that came out around this time of year in each of the last few years (four by default), since older games often cost less, with price links (PriceCharting, and shop links that can be kept to some consoles, such as Deku Deals for the Switch).

**Done: viewers, and a check without signing in** (0.3.0, D46, D47; 2026-09-28). The first part of several people: other people sign in to look at the owner's collection without changing it. The owner is one person and can hand that over; viewers are invited with a link and choose their own password; the server refuses them anything that changes data, and keeps the owner's prices paid, notes and system pages from them unless the owner shares them (settings). On a phone, the sign-in page leads with scanning a game (a setting, off by default): whether the owner has it (with its value, a setting) or needs it (its wishlist priority, and price links), without signing in. Family reach it through Cloudflare Access invites on the owner's install. **Next: several collections in one Squirrelcade:** each person can keep a collection of their own and view others'. That's its own project: every part of the data (the collection, catalog answers, settings, the wishlist, notes, sets, the PC library) becomes per collection, while public data (Wikipedia and IGDB) can be shared; a data plan comes first for the owner to look over.

**Done: Top 100 lists, console history and a timeline** (0.4.0, D48, D49; the user's brief, 2026-09-28). Squirrelcade is the information layer beside RomM: each console's Top 100 in rank order with what the collection has of each game and a link to play it in RomM (owned games only, unless a setting says otherwise), each console's history with a few games to start with, why games matter (in the list and the game drawer), and a timeline of consoles and landmark games. Texts are drafts from Wikipedia with Claude's help, with sources, until the owner checks them. Next for it: more consoles' histories (one at a time), the owner's own Top 100 lists, and franchise lineage (a game's place in its series across consoles).

**Done: parts you can switch off** (0.4.0, D50): Settings > Features.

**Done: Copies** (0.4.0, D51, the user's request): every copy of each game across consoles and PC, sealed games playable another way first, with the owner's corrections. Next for it, if wanted: the same corrections for the PC library's matrix and the wishlist's owned-on-PC points.

**Done: ideas from other collection apps** (0.6.0, D52 to D59; researched in [docs/IDEAS.md](IDEAS.md), all nine picked by the owner): what you played (status, rating, the backlog, "What to play next"), share links for the wishlist and the games for sale, a spreadsheet of your own as the collection, each copy's place, tags, loans and photos, PC wishlist prices from IsThereAnyDeal, a sell and trade list, statistics, and a printable report. With them, the collection as one Excel workbook (D58) and a license (AGPL-3.0, D60).

**Later:** several collections in one Squirrelcade, a better name for the Wishlist section (it holds the wishlist, the PC wishlist, Coming soon, Past releases and Scoring), export straight to Google Sheets (for now, Collection > Download gives a CSV or an Excel workbook, which Sheets opens), and public release work (a clean snapshot of the repository, screenshots).

## Moving off the old system

- Squirrelcade doesn't read the old workbook (D24). The move is the PriceCharting export, catalogs from Wikipedia and IGDB (with the user's curated console lists added as CSV lists where they want them), the Review page's questions, and the user's preferences, set in the welcome guide and Settings.
- Since the switch-over (D34), the old Google Drive intake folder isn't watched: PriceCharting exports go to Squirrelcade (an upload, or its watched folder).
- What remains of the old system (the PC library's workflows, the Playnite reader, the Sheets) is never changed without the user's OK (see `AGENTS.md`).

## Testing

- The domain logic lives in the shared core package with unit tests, including the old system's known cases: title alias misses that led to duplicate purchases, the five-versus-six eligibility boundary, PC versus PC Engine, Game-Key Card parity, compilation coverage, subscription versus permanent ownership.
- Collection updates and catalog builds are tested against fixtures derived from real data, which stay in `private/` and out of git; the tests themselves use small made-up collections and a fake Wikipedia and IGDB.
- Each console phase is checked against the old system's last good results, with differences explained before sign-off.
- CI builds the Docker image and walks through a fresh install in it (`scripts/smoke-test.mjs`): the API first, then the interface in the runner's Chrome (`scripts/ui-test.mjs`, with playwright-core and no browser download): sign-in, every page and settings page (each scanned with axe-core for serious accessibility problems, in dark and light mode), the game drawer, the header's search, Store Mode (also with the browser offline, buying a game there), the main forms (the first account made on the setup page, the first export taken by the welcome guide, a later one uploaded on Collection updates, a setting saved, the settings exported to a file and imported, a Review question answered, a wishlist game snoozed, a note, a backup, a set made from a CSV), the phone menu and phone widths, and a page whose code fails to load. Anything a page throws, shows as a failure or answers with a server error fails the run, as does a serious accessibility problem. `SMOKE_UI=1 node scripts/smoke-test.mjs <address of a fresh install>` runs the same locally (`UI_BROWSER=msedge` for Edge; `UI_BROWSER=webkit` for Safari's engine, what an iPhone runs, once `npx playwright-core install webkit` has put Playwright's WebKit in the shared ms-playwright folder: every check but opening with the connection cut, which Playwright's WebKit for Windows can't do, so there it checks everything is ready for it; `UI_SHOTS=<folder>` keeps a screenshot where it stops; `UI_VIDEO=<folder>` keeps a video of every page it drives, encoded by Playwright's own ffmpeg, which playwright-core finds in the `ms-playwright` folder other projects on the PC may have filled: it downloads nothing itself).

## Still open

- **How friends' Squirrelcades exchange collections** (asked 2026-10-04; the next phase after the Sunday build, to compare collections and suggest trades). Most installs sit behind a sign-in at home, so the way in is the open question. Email is the owner's leaning: each install sends a share file to the friend's address and reads theirs from its mailbox, as it already reads PriceCharting's export emails, with no server reaching another. Other ways: a share file passed by hand; a key per friend for direct calls (behind Cloudflare Access that needs an Access service token for the friend: workable, fiddly for most people); a small relay. What is shared stays the owner's choice and can be withdrawn. A proposal (the share file first, then email; what's shared; the Friends page; phases) is in [docs/design/friends.md](design/friends.md), for the owner's decision.
- **Prices of games not yet owned** (for the wishlist's market urgency, and later price history and budget). Decided for now: no paid plan (D01, confirmed again on 2026-09-27; the user would reconsider the Legendary plan only if it could serve an application), so the market-urgency points stay unused unless a free source turns up. Asking PriceCharting for written permission remains possible.
- **Rarity** (the user asked for a rarity column on console pages: very rare, rare, uncommon, common). Real rarity is price, and no free price source is settled; eBay's developer API (asking prices, free with a developer account) was suggested. Off the list for now; the user wants to talk it through later (2026-09-27).
- **Where Game-Key Card marks come from** (researched 2026-09-27; Nintendo Life is now a catalog source, D35). The setting (D33) knows them from a list's Format column; the user's Switch 2 list got its column from Nintendo Life, which the old system read. Not usable: Wikipedia (the Switch 2 list has title, developer, publisher and date only; "Nintendo Game Card" explains the three kinds of card without a list), Wikidata (nothing), IGDB (release formats are only Digital and Physical). Maintained lists: Nintendo Life's two guides ("Every Nintendo Switch 2 Game-Key Card Release" and "... With The Full Game On The Cart"; officially confirmed releases only; 105 and 57 games on 2026-09-27, the same formats as the user's list for every game both have, 8 games newer); Nintendo Everything's list (about 150, with regional notes); Deku Deals (a badge on each game page and a full list, but it doesn't serve software, only browsers); Nintendo Wire (full card, Game-Key Card and code in a box; not updated since February 2026). Nintendo Life's terms allow personal, non-commercial use with credit, not redistribution, so a reader would be an opt-in source for the owner's own install. A copy in hand tells by the model code on the back of the box: BEE-P a Switch 2 game card, NXS-P a Switch 2 Edition card, POT-P a Game-Key Card (and a key icon on the card). The same game can differ by region (Daemon X Machina: Titanic Scion is a Game-Key Card in Asia only), and a code in a box is no card at all.
- **Japanese titles with the subtitle left out** ("Doraemon 2" for "Doraemon 2: Nobita no Toys Land Daibouken"): PriceCharting shortens most Japanese titles this way. Built as a setting, off by default (D42): Settings > Catalogs > "Titles without their subtitle", on consoles of Japanese releases or everywhere; on the owner's Super Famicom it would count 37 more games. Waiting for the owner's say, since it breaks the rule that a look-alike is never a match. (Titles romanized differently are done, D40: "Cho" / "Chou", "Yakyuu" / "Yakyū" match on catalogs of Japanese releases, IGDB's other names included.)
- **A copy of the database off the server** (done 2026-09-27). Settings > Storage > Second backup folder copies each backup to another folder (a mounted NAS share, say), with the same number kept; a missing folder is a health warning and a failed backup task. The owner's server already carries Squirrelcade's folder, backups included, to the NAS in its nightly archive of its Docker folder (the home lab notes have the details), so their install needs no second folder.
- Game of the Day: stays with ChatGPT for now. Squirrelcade can answer its ownership questions through `POST /api/v1/owned` (2026-09-28); connecting the two waits for the owner.
- Publishing this history or a clean snapshot, before going public (the license is chosen: AGPL-3.0, D60). A clean snapshot is safer: a few early commits mention a host name and a LAN address (fixed in 619844c), and the decisions log, status and some commit messages use example titles from the owner's collection (which games are owned, and how) to explain matching choices.
- A backup for `private/`, which exists only on the development PC.
- Hardening before a public release: a Content Security Policy (it has to allow the barcode scanner's WebAssembly on phones without a native barcode reader, so it waits for a test on an iPhone). (The service worker so Store Mode opens with no connection at all is done: 0.12.0, D73.)
- Store Mode without a connection, a next step if the owner wants it: Check a list answering from the phone's copy. ("I bought it" without a connection is done, 2026-09-28.)
- Windows long paths are disabled on the development PC; Node dependency folders can hit the 260-character limit. Keep paths short, or the user enables long paths in Windows (only the user can change that setting).
