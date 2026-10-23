# History: the implementation plan

**Status: a plan for review** (2026-10-23), built from [history.md](history.md) (the idea and its sources) and [magazines.md](magazines.md). Nothing here is built. Mockups: [history/](history/).

## In short

- **What it adds:** every game seen two ways, **At the time** (how it was seen when it came out) and **Looking back** (how it's remembered), with **Where it came from** between them; a **Magazines** section to collect, read and search the owner's scans; a **History** section with a **Time machine** (a month at a time); video channels the owner picks, played inside Squirrelcade.
- **It's optional:** one switch, **Settings › Features › History**, with its parts under it. Off, Squirrelcade is exactly what it is today, a collection manager: no History section, no History part on a game, nothing fetched for it. Collecting magazines (the Magazines section) works with History off.
- **How it's built:** seven phases, each shippable on its own and released to the owner's server as it's done: about 13 to 18 build sessions in all (a session being a block like the ones that built Recently added or Places: build, test, walkthrough, release).

## What six decades of games showed

The same checks were run on one well-known game per decade (2026-10-23): its Wikidata identifiers, its Wikipedia review box, every citation in its article with its date, and what videos of its time exist.

| Decade | Game | Reference sites (Wikidata) | Wikipedia's review box | Sources from its own time in the article | Videos of its time | What "At the time" rests on |
| --- | --- | --- | --- | --- | --- | --- |
| 1970s | Space Invaders (1978) | 84 | 3 rows, all later (AllGame, Eurogamer 2007, a 1994 Game Boy review) | 11 (1977-80): the arcade trade papers (Japan's Game Machine, Cash Box, Play Meter), *Video* magazine's 1980 Arcade Alley column, newspapers; 4 scans at the page | Commercials, uploaded years later | Trade papers, newspapers, the first game columns |
| 1980s | Super Mario Bros. (1985) | 102 | 4 rows: UK magazines of 1987-89 (ACE, CVG, The Games Machine) | 25 (1984-87): trade papers, CVG's 1986 arcade columns, the *Top Score* newsletter, a 1985 Macy's newspaper ad, the instruction booklet; 7 scans | Commercials; Nintendo's interviews are from 2010 on | Trade papers, early magazines, ads and the manual |
| 1990s | Super Metroid (1994) | 96 | 25 rows: EGM (vol. 7 no. 6, p. 28), Famitsu #279, Hyper #8 p. 32, CVG #152 p. 64...; 11 scans | 29, 24 of them magazines | None (before YouTube) | Magazines: the richest decade |
| 2000s | Halo: Combat Evolved (2001) | 85 (Wikidata has no IGDB link for it: found through its article) | 18 rows: IGN, GameSpot, GameSpy and 1UP of November 2001 (archived), Edge #105, Official Xbox Magazine #1 (a scan), Next Generation #1 | 46: websites lead, magazines alongside | TV reviews (X-Play reviewed the 2003 PC port), GameSpot's own site videos; YouTube from 2005 | Websites (archived copies) and magazines |
| 2010s | Breath of the Wild (2017) | 107 | 17 rows, nearly all dated March 2, 2017, archived; Edge #304 pp. 104-107 | 154 | The channels' own review videos | Launch-day web and video reviews, print alongside |
| 2020s | Tears of the Kingdom (2023) | 110 | 12 rows | 75 | The channels' own review videos | Launch coverage; Looking back has barely begun |
| 2020s, new | Donkey Kong Bananza (2025) | 39 | 18 rows | 138, all from its launch | The channels' own review videos | Launch coverage only; Wikidata still thin |

Overall, Wikidata links 152,532 games to IGDB, and 29,253 of them have an English Wikipedia article: reference links reach almost any game, reviews of the time the notable ones (most of what collectors own).

**What it changes in the build:**

1. **All dated citations, not only the review box.** For the '70s and '80s the box is empty or later; the contemporary sources are citations in the article's text (Reception, Release). Each citation is kept with its date, kind and work, and sorted into At the time or Looking back.
2. **Find Wikidata through the article.** Halo has no IGDB link on Wikidata; its article does link it. The article is the main way in, the IGDB id a fallback.
3. **A tolerant parser.** Named and multi-line citations (Halo's Famitsu row spans lines), templates inside titles, scores like "Xbox: 97/100, PC: 83/100" or "Essential".
4. **Empty states that know their era.** Before 1995 there's no "web of the time"; before 2005, no video reviews of the time. The page says so instead of looking broken.
5. **New games keep changing.** A game under six months old is re-read weekly, then monthly; its Looking back says it's still being written.
6. **Trade papers and newspapers are magazines too.** Cash Box, Play Meter, Game Machine and newspaper clippings belong in the Magazines library like EGM.
7. **Other languages.** Famitsu, Game Machine, German and French magazines keep their own titles, with a language tag.

## What changes in Squirrelcade

| Where | Today | With History on |
| --- | --- | --- |
| **PC games** | Their own section (PC library, PC wishlist, PC deals); a PC game opens the PC library page | Under the Stash and Acorns (to decide); a PC game opens the same game page as a console game, its storefronts and hours where a console game shows its condition and photos (mockup 7) |
| **The menu** | Today, Stash, Acorns, Nutshell, Friends, Settings, System, Help | **Magazines** (Library, Reading now, Wanted, Search) and **History** (Time machine, Timeline, Consoles, Videos) added, each with its line and mark; Timeline and the consoles' histories move into History (still linked from Platforms) |
| **A game's drawer** | Details, why it matters, Top 100 place, your copies, notes, links | **Your copy first**, right under Have it: a card with its condition, what you paid, what it's worth, where it's kept, its test and rip, its tags, its standard photos as small thumbnails that open full size, and **Edit this copy** inside it (with History on or off). A game on several consoles: one card, every platform it came out on, the console you came from open (mockup 8). On a phone, the same order in one column (mockup 9). Then the **History** part: the game's own timeline strip and **At the time / Where it came from / Looking back** (mockups 1, 2, 6) |
| **Reading** | Nothing | A full-screen reader for the owner's scans, the games on each page outlined and tappable (mockup 3) |
| **Settings** | Features: the optional parts | **Features › History** and its parts (Reviews and links, Videos, Magazines); **Settings › History**: the At the time window, Reference sites, Video channels, where videos play; **Sources**: an optional YouTube key; **Magazines**: the folder, reading, OCR (mockup 5) |
| **Review** | Titles, copies, barcodes | New tabs: **Videos** (likely matches), **Magazines** (games on pages), **Came from** (games named in articles) |
| **Today** | The game of the day, releases, loans... | A **This month in history** card: what came out 10, 20, 30 years ago this month, and the owner's magazines from that month |
| **Store Mode** | Have it / Need it, value, sets | A line of its time: "EGM: 9 9 9 9 (1994)" |
| **Search** | Games | A **Magazines** tab: words across every issue |
| **Claude and Talk** | The collection, the wishlist | The reviews of the time and magazine mentions: "what did Nintendo Power say about it?" |
| **Help, README, website** | Collecting | History and Magazines pages; "What leaves your server" updated; the pitch adds understanding and experiencing the games once phase 1 ships |
| **Outside contacts** | Wikipedia (catalogs), the services you set up | Wikipedia and Wikidata (more of them), the Wayback Machine's lookup, YouTube (from your browser when you press Play; from the server with a key) |
| **Storage** | The collection | A few MB of history per thousand games; magazine text about half a GB for a large library |

## PC games

The owner's question on review (2026-10-23): the plan left the PC library out, and "maybe PC could be brought into the Stash and Acorns". Today the PC library is its own menu section (PC library, PC wishlist, PC deals), its games open the PC library page rather than a game's page, and on the owner's install it's larger than all the consoles together. Two ways, for the owner to choose (mockup 7):

- **The owner's idea: PC into the Stash and Acorns.** PC library under the Stash; PC wishlist and PC deals under Acorns: the menu's rule (games you have, games coming in and going out) holds, and one section goes. PC stays its own page with its own totals, never mixed into the console lists.
- **Claude's suggestion: PC as a platform, in two steps.** (1) The same menu move, with the totals side by side ("980 console games · 1,240 PC games"), never added up unless a setting says so: ownership elsewhere stays related, never the same thing. (2) With History, a PC game gets the same game page as a console game: **Your copies** shows its storefronts (Steam, GOG, Epic, Game Pass), hours played and achievements, and any console copies of the same game; the same History part below (PC games have articles and reference sites like any game; PC magazines go in the same library: Computer Gaming World's whole run is scanned on the Internet Archive, and PC Gamer's issues are cited at the page); and PC appears among the platforms in the Nutshell. Step 2 joins phase 0, which builds the game page anyway.

## The phases

Each phase lists what's built, how it's checked (with the decade games), and its size.

### Phase 0: groundwork (small, 1 session)

- **Your copy at the top of a game's page** (the owner's review, 2026-10-23: "this is still primarily a collecting application, so I want to make sure that we have the collection portion covered"): under Have it, a card with the copy's condition, price paid, value, storage location, test and rip, tags, and its standard photos as thumbnails (tap for full size). It comes first whether History is on or off.
  - **Edit this copy inside each copy** (the owner's second review, 2026-10-23: "move that edit my copy to the actual copy"). The Edit my copy button beside Have it (Edit a copy, with several) goes; every copy's card has its own Edit this copy. This replaces the owner's rule of 2026-10-11 (Edit my copy beside Have it), so Help's Collection and Your copies pages change with it. Until phase 0, the top button stays, since today the copies sit further down the page.
  - A game on several consoles gets one card for all its copies: a row of every platform it came out on (the owner's lit with their count, the rest dashed with **Want it**), the console the page was opened from shown in full (each copy with its photos and its own Edit this copy), the other consoles a line each (one copy: Edit; several: Open), PC with its storefront and hours (mockup 8). The History part is the game's, across its releases: each release on the timeline, and At the time opens on the first release's reviews, with a chip for each later release's (Grand Theft Auto V: 2013 PS3 and Xbox 360, 2014 PS4 and Xbox One, 2015 PC, 2022 PS5 and Series X|S).
  - **Play on RomM at the top** (the owner: "I'd like RomM to have a button on top that says Play on RomM"): beside Have it, when RomM has the game: **Play on RomM** when RomM can play it in the browser, **Open in RomM** otherwise. It replaces the small RomM and Play links at the bottom of the page.
  - **A copy's worth, as a graph** (the owner: "graph the price data for a particular copy... just click the copy, and that is where it comes up. I don't want the collection stuff to take too much more"): the card stays its size; Worth gets a small line beside it, and clicking it opens the graph over the page: the copy's value at each collection update since it was added (the price points Squirrelcade already keeps, from PriceCharting's export, in the copy's condition), a dashed line at what was paid, now, the change since added and over what was paid, a value per point on hover or tap, and Show as a table (mockup 10). Today the same history is the small line with hover in Your copies.
  - **A game you don't have yet** (the owner: "if I don't have it, how do I look it up and buy"): in Your copy's place, a **Get it** card in gold: the shop links (Settings › Interface, used marketplaces first, the rest folded), PriceCharting for its prices (Squirrelcade has prices only for games in the collection; prices for others stay an open question, since PriceCharting's API is a paid plan), its acorns and why, **I bought it** (opening Add it with the whole copy), Snooze and Not a target, and its other versions and remasters you have (mockup 11). History is the same below it.
  - **On a phone** (mockup 9): the page fills the screen; the copy card in one column (its facts two by two, the photos in a row, Edit this copy the card's full width); the platforms row scrolls sideways; History's timeline scrolls sideways, and its three tabs stay at the top while scrolling.
- **Settings › Features › History** with its parts; the History section's shell; the drawer's History part as an empty frame.
- **Each game's identity:** the catalog build keeps the Wikipedia article each list links (it reads it now and drops it); the article's Wikidata item from Wikipedia (`pageprops`, 50 titles a request); the IGDB id as a fallback. A `game_refs` row per game.
- Checked: History off changes nothing (walkthrough); on, Super Metroid is Q1194825 and Halo Q276217 (through its article).

### Phase 1: reviews of the time, where it came from, learn more (medium to large, 2 to 3 sessions)

- **Core (packages/core):** the review box parser (outlet keys such as EGM, GPro, NP, Fam, GSpot, IGN, NLife, Edge, CVG, MC, OC, GR, and the box's own rev1/rev1Score rows, to full names); a citation parser (date, kind, work, issue, volume, page, link, archived copy, language); the sorting into At the time or Looking back by date against the first release (18 months, a setting); the lineage spotter (games named in Development and Legacy, matched to the catalogs with the title matcher, magazines and people left out).
- **Server:** the history reader (one article's wikitext a game, cached a month; a game under six months old, a week), Wikidata's identifiers and link formats (SPARQL, a few hundred games a query), the Wayback lookup for links without an archived copy, a task (**Read game histories**: owned and wishlist games first, at night), `GET /api/v1/games/:key/history` (one answer for the drawer).
- **Web:** the drawer's History part (timeline strip, the three tabs), Reference sites (a setting like Shop links: on and off per site, sites of your own with `{title}`), Review > Came from.
- Checked (tests with trimmed articles of the seven decade games as fixtures): Space Invaders' At the time lists its 11 sources (Cash Box 1979, Play Meter 1980, Game Machine #102...); Super Mario Bros.' lists CVG #53 (March 1986); Super Metroid's lists 25 outlets with EGM's issue and page; Halo's IGN and GameSpot reviews of November 2001 open their archived copies; Breath of the Wild's 17 launch reviews and Edge #304; Donkey Kong Bananza's Looking back says it's still being written; Super Metroid's Came from has Metroid, and its legacy Symphony of the Night, Shadow Complex and Axiom Verge, but not Nintendo Power (a magazine).

### Phase 2: Magazines, collecting and reading (large, 2 to 3 sessions)

As [magazines.md](magazines.md) phase 1: the section; the magazines folder read on a schedule (issues named from their file names, covers from page 1); a CSV of issues; physical copies and wanted issues (copy keys, so photos, places and tags work); the reader (MuPDF or Poppler drawing pages into a cache, a zoom library such as PhotoSwipe or OpenSeadragon, reading position).

- **The link that matters most:** a review citation's magazine, issue or date, and page find the owner's issue, and **Open your scan** opens it at the page. A printed page number and the file's page can differ (covers, inserts): each issue keeps an offset, set once by the owner ("this is page 28") until OCR reads page numbers (phase 4).
- Checked: with EGM June 1994 in the library, Super Metroid's EGM row says Open your scan and opens at page 28; trade papers (Cash Box) and clippings file like magazines.

### Phase 3: videos (medium, 2 sessions)

- **Without a key:** paste a video onto a game (its title from YouTube's oEmbed), IGDB's game videos (trailers), Wikipedia's cited videos, each channel's newest uploads (its RSS feed).
- **With a key (optional):** each channel's uploads list read once (1 unit per 50 videos) and matched to the games; Review > Videos for likely ones; matched videos refreshed monthly (YouTube's 30-day rule), unmatched ones not kept.
- **The player:** a cached thumbnail first (served by Squirrelcade), YouTube's privacy-enhanced player on Play, `referrerpolicy="strict-origin-when-cross-origin"` on its frame (error 153 otherwise, since Squirrelcade sends `same-origin`), full screen; Watch on YouTube for videos that don't allow embedding. Channels marked as archives of their era date videos by what they show.
- **Video channels** setting with the starting list (IGN, GameSpot, Gaming Historian on; others listed off).
- Checked: Breath of the Wild's IGN and GameSpot reviews of March 2, 2017 under At the time (with a key); a pasted 1980 Space Invaders commercial under At the time; full screen on the owner's iPhone.

### Phase 4: magazine text and search (large, 2 to 3 sessions)

As magazines.md phase 2: the scan's own text first; a benchmark on three of the owner's issues (Tesseract through OCRmyPDF, and PaddleOCR's ONNX models) before choosing; **Read magazines' text** at night at low priority; SQLite FTS5 search; **Search magazines** and a header search tab; printed page numbers read to set each issue's offset.

- Checked: "Chrono Trigger" finds its pages across issues and opens each at the page with the words marked.

### Phase 5: the games on the page (large, 2 to 3 sessions)

As magazines.md phase 3: title spotting on each page within the magazine's consoles and dates; outlines from the OCR's boxes; the game card on top of the page (owned and where kept, RomM's Play, this page's score, other mentions); mark games by hand; Review > Magazines; **In the magazines** in the drawer, seeded by Wikipedia's citations; scores by each magazine's patterns, then the AI model if set up.

- Checked: on EGM June 1994 p. 28, Super Metroid is outlined green and its card offers Play in RomM.

### Phase 6: the History section (medium, 2 sessions)

- **Time machine:** a month's releases (catalog dates, Wikidata's to fill gaps), the owner's magazines of that month, the reviews published, the videos of the time; **On this day**.
- **Timeline** and the consoles' histories moved in; the game's timeline strip completed with re-releases; Today's **This month in history**; Store Mode's line of its time.
- Checked: April 1994 lists Super Metroid (April 18), Fatal Fury 2, Knights of the Round and the rest, and Famitsu #279's review.

### Releases

Each phase goes to the owner's server when it's done (edge). Public releases group them: 1.3.0 with phases 0 and 1 (and the README and website pitch), 1.4.0 with magazines and videos, 1.5.0 with text, the games on the page and the History section.

## Across the phases

**New tables:** `game_refs` (article, Wikidata item, identifiers, first release, when read), `game_sources` (every dated source: outlet, score, date, kind, magazine issue and page, links, era), `game_lineage` (inspired by, inspired, with confidence and the owner's answers), `video_channels`, `game_videos`, `archived_pages`, and the magazines tables of magazines.md.

**New endpoints:** `GET /api/v1/games/:key/history`; `POST /api/v1/games/:key/videos` (paste); `GET /api/v1/history/month/:yyyy-mm`; Review's lineage and videos answers; the magazines endpoints of magazines.md. All owner only, or as viewers' settings allow.

**New tasks:** Read game histories (nightly, owned and wishlist first, then the rest); Read video channels (daily feeds; with a key, a monthly full read and refresh); the magazines folder scan and text reading (magazines.md).

**Settings (each with a neutral default):** features.history (and its parts), history.atTimeMonths (18), history.referenceSites, history.videoChannels, history.videosPerGame (6), history.playIn (Squirrelcade), sources.youtubeKey, and magazines.md's.

**Privacy:** Wikipedia, Wikidata and the Wayback Machine are asked from the server; YouTube from the viewer's browser only on Play (thumbnails come through the server); scans never leave the server. Help's "What leaves your server" lists each.

**Licenses and terms:** Wikipedia's text (CC BY-SA) credited where shown, as the catalogs already do; Wikidata is CC0; YouTube through its player and API terms (no downloads, the 30-day rule); other sites linked, never read (no scraping of Metacritic, GameFAQs or IGN).

**Load:** the drawer asks once per game and gets a stored answer; Wikipedia about one request a second with Squirrelcade's User-Agent; Wikidata in batches; YouTube under 3,000 units a day; OCR at night, at low priority.

**Tests:** the weekly live check of the seven decade games (a scheduled GitHub workflow opening an issue on a drop), trimmed articles of the seven decade games as fixtures for the parsers (the counts above as expectations); server tests with stand-in Wikipedia, Wikidata, Wayback and YouTube; walkthrough steps for the switch, the drawer's tabs, the reader opening at a page and the video player; one check on the owner's iPhone for the reader and full screen.

## Keeping it working, on everyone's installs

The owner's question (2026-10-23): "How do we deal with maintenance with it, particularly when this is deployed to other people?"

**The shape that keeps it small:** every install reads the public sources itself (Wikipedia, Wikidata, the Wayback Machine, YouTube with its own owner's key); there's no Squirrelcade server in the middle to run, pay for or keep up. What needs care is what the code assumes about those sources, and the lists it ships with. Both change only in releases.

**What can break, and what happens then:**

| What changes | How it shows | What's built so it holds |
| --- | --- | --- |
| Wikipedia's review box or citation style | Fewer reviews read | A forgiving reader; anything unread is left out, never shown broken; the last good reading is kept (outside sources fail soft) |
| Wikidata's identifiers (MobyGames moved to a new id scheme in 2024) | A reference site's link missing | Link formats read from Wikidata itself (its "formatter URL"), not written into the code; a site whose property is retired falls back to its replacement |
| YouTube's embedding rules (error 153 in 2025) or API | Videos not playing inline | Watch on YouTube as the fallback, always shown; the key optional (most installs won't have one); channels kept by their id, not their @handle |
| A channel closes, a video is removed | A dead video | The monthly refresh (YouTube's 30-day rule asks for it anyway) drops it |
| A site in the starting lists closes | A dead link | Removed from the defaults in the next release; links the owner added stay theirs |
| A new magazine or outlet in the review boxes | Its short name shown as is | The box's own label used for an unknown outlet; the names list grows in releases |

**Finding out before users do:** Squirrelcade sends nothing home (no telemetry, by principle), so breakage is caught three ways. (1) **A weekly check in GitHub** (a scheduled workflow in the public repository) reads the seven decade games live and compares them with what they should give (Super Metroid's 25 outlets, Space Invaders' 11 period sources, Halo found through its article...); a drop opens a GitHub issue. (2) **Each install's System › Status** shows each source's last good read and its errors, and tells its owner only when a source keeps failing (D164). (3) **The owner's own install**, which runs edge first.

**Being a good neighbor at scale:** with many installs, each one asks politely and rarely: Squirrelcade's own User-Agent with its version and the project's address (Wikimedia's policy asks for it), about one request a second, answers kept a month, and a cheap check first (Wikipedia gives each article's latest revision for 50 titles in one request: an article is read again only when it changed). If installs grow into the thousands, a **history data pack** can be built once a week by a GitHub workflow (the parsed review boxes, citations and identifiers for the ~29,000 games with articles; Wikipedia's text is CC BY-SA, so the pack is too, credited) and published with the releases: installs download one file, and read live only what's newer or missing. Not needed at the start; a decision for later.

**When the reader improves:** each reading keeps the version of the reader that made it. A release with a better reader re-reads games gradually in the background (owned and wishlist games first), not all at once.

**What other people have to do:** nothing beyond turning History on. The tasks run by themselves at night, fail soft, and say so on System › Status; the starting lists come with updates; their own changes (channels, sites, answers on Review) are never overwritten. Magazines are the one part with their own care: the scans are theirs to keep on their own storage.

**What the project has to do:** answer the weekly check's issues when they open (expected: a few times a year, mostly YouTube and Wikipedia template changes), refresh the starting lists now and then, and keep the decade-game tests passing. A few hours a month at most, in releases like any other.

## Risks, and what keeps them small

| Risk | What keeps it small |
| --- | --- |
| Wikipedia's articles vary | A tolerant parser tested on many decades; a part that can't be read is left out, never shown broken |
| Wrong matches (games named in articles, videos, magazine pages) | Confidence thresholds, Review, the owner's answers remembered |
| YouTube changes its embedding or quota | Watch on YouTube as the fallback; the key optional |
| Copyright | Scans stay on the owner's server; links and embeds only; text read from scans stays local |
| The work grows | Phases ship on their own; the OCR choice waits for a benchmark |
| Obscure games have little | Reference links still reach most games; empty states say why |

## For the owner to decide

1. The sections' names and marks (Magazines and History, with a magazine and an hourglass as drafts).
2. Whether History starts on for new installs (on for the owner's).
3. The starting video channels.
4. A YouTube key (free) now, or later.
5. The At the time window (18 months).
6. The order: phases 0 and 1 first (recommended), or magazines first while the scans are gathered.
7. ~~Where the History part sits~~ Decided (the owner, 2026-10-23): the page opens with Your copy (the card with photos), History below it; Edit this copy inside each copy, not beside Have it.
8. PC games: into the Stash and Acorns (the owner's idea), or that plus PC as a platform with the same game page (Claude's two steps).
9. Magazines' text reading (OCR): in the main download (about 40 to 60 MB more), or an optional add-on only people who want OCR install; once the timing test shows how much it's wanted.
10. A game on several consoles: At the time opens on the first release's reviews (suggested: that's when the game was new), or on the release of the console you came from.
