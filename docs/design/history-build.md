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
| **The menu** | Today, Stash, Acorns, Nutshell, Friends, Settings, System, Help | **Magazines** (Library, Reading now, Wanted, Search) and **History** (Time machine, Timeline, Consoles, Videos) added, each with its line and mark; Timeline and the consoles' histories move into History (still linked from Platforms) |
| **A game's drawer** | Details, why it matters, Top 100 place, your copies, notes, links | **Your copy first**, right under Have it and Edit my copy: a card with its condition, what you paid, what it's worth, where it's kept, its test and rip, its tags, and its standard photos as small thumbnails that open full size (with History on or off). Then the **History** part: the game's own timeline strip and **At the time / Where it came from / Looking back** (mockups 1, 2, 6) |
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

## The phases

Each phase lists what's built, how it's checked (with the decade games), and its size.

### Phase 0: groundwork (small, 1 session)

- **Your copy at the top of a game's page** (the owner's review, 2026-10-23: "this is still primarily a collecting application, so I want to make sure that we have the collection portion covered"): under Have it and Edit my copy, a card with the copy's condition, price paid, value, storage location, test and rip, tags, and its standard photos as thumbnails (tap for full size). Several copies: one line each, the best first, each with its photos. It comes first whether History is on or off.
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

**Tests:** trimmed articles of the seven decade games as fixtures for the parsers (the counts above as expectations); server tests with stand-in Wikipedia, Wikidata, Wayback and YouTube; walkthrough steps for the switch, the drawer's tabs, the reader opening at a page and the video player; one check on the owner's iPhone for the reader and full screen.

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
7. ~~Where the History part sits~~ Decided (the owner, 2026-10-23): the page opens with Your copy (the card with photos), History below it.
