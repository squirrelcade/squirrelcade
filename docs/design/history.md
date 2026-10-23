# History: every game as it was seen then, and as we see it now

**Status: planned, not built** (the owner's direction, 2026-10-23: "the next step of Squirrelcade is to improve its history section... a thing that will allow people to learn about games as much as play the games and collect the games"). Researched 2026-10-23; nothing here is decided until it's built. The magazines part has its own design: [magazines.md](magazines.md).

## Why

> "Appreciating a game is more than just playing it. Playing is, of course, by far the most important part of it. But understanding how it was viewed at the time, understanding what inspired it and what it inspired, all of those things are really important to help appreciate a game and its viewpoint in history. And understanding how people at the time felt the game was... I wanted Squirrelcade to be collecting, understanding your collection, adding, removing stuff from it, but also be able to have it help you experience video games and video game history." (the owner, 2026-10-23)

Collecting stays Squirrelcade's core. History is how it helps people understand a game and its place: when it came out, where it came from, what it led to, and how it's remembered. It's a principle of the plan now ("A game is more than a copy", [PLAN.md](../PLAN.md)).

## The idea: two viewpoints

Squirrelcade looks at games from today, looking back: what a game is worth now, its place in a Top 100, how it's remembered. The owner wants the other view too:

> "I would like elements in the history that allows you to have the viewpoint of that game from the time of history that it's in. So like contemporary reviews, as far as YouTube's concerned, or in the magazine, you could read articles directly... about those games. So if... you're talking about Super Metroid, if Super Metroid is in one of the Nintendo Power [issues], you can like click on it and go right there and understand it more."

So every game gets two views of its history:

- **At the time:** what the world said when it came out. The magazines of those months (the previews before it, the review after, opened at the page in the owner's own scans), the review scores of the day (EGM's Review Crew, GamePro, Famitsu, the websites of the late '90s), the web pages as they looked then (through the Internet Archive's Wayback Machine), and the video reviews and commercials of its era.
- **Looking back:** what's been said since. Retrospectives and documentaries, today's video reviews of re-releases, essays, and the reference sites (Wikipedia, MobyGames, GameFAQs, StrategyWiki...).

**Which view a source belongs to is decided by dates:** its own date (a magazine's cover date, a review's date, a web page's date as archived, a video's date) against the game's first release. Up to 18 months after release (and anything before it, the previews) is **At the time**; later is **Looking back** (the window a setting). A channel or outlet can be marked as an archive of its era (old TV shows and commercials uploaded years later count as their era, not their upload date).

One fact shapes it: YouTube began in 2005. For a game from 2006 on, the video reviews of its day are on YouTube (IGN's, GameSpot's). For an older game, its own time is in the magazines, the scores and the archived web pages, plus whatever commercials and TV segments people uploaded later. Magazines carry the most weight for exactly the games collectors care most about.

## What a game's page gets

A **History** part in every game's drawer, with **At the time** and **Looking back** side by side (tabs on a phone), and above them **the game's own timeline**: a strip from its first preview to its release to its reviews to its re-releases to the retrospectives, each point opening its source.

**At the time:**

- **In the magazines** (from the [magazines design](magazines.md)): each issue and page about it, the kind (preview, review, cover, guide, codes), the score; a tap opens the owner's scan at that page. An issue the owner doesn't have yet can link to a public scan when one is known (the Internet Archive holds many), or to the issue in the magazines list as **wanted**.
- **Reviews from the time:** each outlet with its score and date (EGM 9, 9, 9, 9, June 1994; GamePro 5/5; Nintendo Power; GameSpot 8.5...), each opening the review itself: the owner's own scan of that magazine page when they have the issue, else the archived web page, else the original. Read from Wikipedia's review table (below).
- **The web, as it was:** the review and news pages of the time as the Wayback Machine kept them (GameSpot's 1990s review address, say), dated.
- **Videos of the day:** reviews from the channels the owner picked, published within the window; commercials and TV segments from channels marked as archives of the era.

**Where it came from, and what it led to** (between the two views, since it spans both):

- **Inspired by:** the games its makers drew on, from its Wikipedia article's development section; **Inspired:** the games that followed its lead, from the article's legacy section (Super Metroid's names the games of the genre it helped name). The games named there are found with Squirrelcade's title matcher (the one the magazine pages use) and shown as links, each marked owned, on another console, or wanted; an uncertain one waits on Review.
- **Its series** (Squirrelcade's series, already kept), **its genre's lineage** where Wikidata has it (Super Metroid: a Metroidvania), and the people behind it where the article or Wikidata names them (its director, its composer: their other games, through the same matching).
- Wikidata's own "influenced by" links are too few to rely on (51 video games had one on 2026-10-23); the articles' text is where this knowledge is. The AI model, if the owner sets one up, can sum up a section in a line; without one, the section's own opening sentences show, with a link to read on.

**Looking back:**

- **Videos:** retrospectives, documentaries and today's reviews from the owner's channels, played inside Squirrelcade (full screen too).
- **Essays and articles:** what Wikipedia's article cites from later years (an Ars Technica "Masterpiece", a USGamer "Daily Classic").
- **Learn more:** the game's own page on the reference sites the owner keeps on (below).
- What Squirrelcade has already: why it matters (the history text), its place in its console's Top 100.

## Where everything comes from

| Source | Gives | Needs | Cost and limits |
| --- | --- | --- | --- |
| **Wikidata** (CC0) | Each game's page on 100+ reference sites (Super Metroid has 107 identifiers: MobyGames, GameFAQs, GameSpot, Giant Bomb, StrategyWiki, HowLongToBeat, The Cover Project, VGMdb, speedrun.com, Retromags, the fan wikis...), **with each site's link format**, found from the IGDB id Squirrelcade already keeps (Wikidata's "IGDB game ID") | Nothing (a polite User-Agent) | One query for a few hundred games; refreshed monthly |
| **Wikipedia** (CC BY-SA, credited as now) | The game's **review table**: each outlet, score and citation; citations carry the date, the **magazine, issue and page** ("EGM vol. 7 no. 6, June 1994, p. 28"), links to **scans on the Internet Archive at the page**, and archived copies of web reviews (Super Metroid's article: 26 outlets, 78 citations with an archived copy). Also the article's summary, its **development and legacy sections** (what inspired it, what it inspired), and its later essays and video citations | Nothing; Squirrelcade already reads Wikipedia's lists (and their links to each game's article) | One request per game, kept a month; owned and wishlist games first |
| **The Wayback Machine** | Archived copies of pages that are gone: `archive.org/wayback/available` finds the snapshot nearest a date | Nothing | A link per page; looked up when shown, cached |
| **YouTube, without a key** | A video the owner pastes (its title from YouTube's oEmbed, no key); videos Wikipedia cites; trailers from **IGDB** (its game videos, with the keys Squirrelcade already has); each channel's **newest 15 videos** from its RSS feed (new reviews of new games, as they come out); a **Search this channel** link per game | Nothing | Free |
| **YouTube, with a key** (the YouTube Data API, a free Google Cloud key) | **Each chosen channel's whole back catalog**, matched to games: a channel's uploads list costs 1 unit per 50 videos (IGN's very large catalog, a few thousand units once; the free quota is 10,000 units a day); searching would cost 100 units a call, so it isn't used | A key, on Settings > Sources like IGDB's | YouTube's policies: data refreshed or dropped within 30 days, so only the matched videos are kept, refreshed monthly (1 unit per 50) |
| **The owner's magazine scans** | Everything in [magazines.md](magazines.md): the pages, their text, the games on them | The scans on a share | Server time at night for the text |
| **Retromags** (through Wikidata's Retromags game ID) | A game's page there: its magazine **ads** and release details | Nothing | A link |

**Not used:** reading sites that have no open data (Metacritic, GameFAQs' pages, IGN's pages): links only, as their terms ask. MobyGames' API is limited and its terms unclear: its pages are linked through Wikidata instead. Squirrelcade never downloads videos or copies articles: it links, embeds and remembers where things are.

## Videos

**Channels are a setting** (Settings > History > **Video channels**), each line a channel and what it's for, with switches: on, off, or removed; add any channel by its address or @handle. A starting list, grouped, to confirm with the owner (well-known channels that have been on YouTube for many years):

| Group | Channels (suggested) | On to start |
| --- | --- | --- |
| Reviews when a game came out | IGN, GameSpot, Game Informer; Nintendo Life, Push Square, Pure Xbox (each console family's reviews); Digital Foundry (how it runs) | IGN, GameSpot |
| Looking back | Classic Game Room, Game Sack, Metal Jesus Rocks (collecting), LGR (PC) | none |
| History and documentaries | Gaming Historian, My Life in Gaming, DidYouKnowGaming, GameTrailers (its retrospectives) | Gaming Historian |
| Archives of their era | channels of old TV shows and commercials (the owner's picks) | none |

Each channel line also says **which words mark a review** in its titles ("Review", "Video Review", "Retrospective", "Quick Look"), and whether it's an archive of its era (dated by content, not upload).

**Finding a game's videos:** each channel's uploads are matched to the catalog's games with Squirrelcade's own title matcher (numbers either way, subtitles, other names), helped by a console named in the title and the date against the release. A sure match is shown; a likely one waits on **Review > Videos** (**This is it** / **Not this game**), and answers are remembered; the owner can also paste any video onto a game.

**Watching in Squirrelcade:** a thumbnail first (fetched and cached by Squirrelcade's server, so nothing reaches Google until **Play** is tapped), then YouTube's player in place, in its privacy-enhanced mode (youtube-nocookie.com), with **full screen**. Two technical musts found in the research:

- YouTube's embedded player now needs the page's address sent with its request (error 153 otherwise). Squirrelcade sends `Referrer-Policy: same-origin`, which strips it, so the player's frame carries its own `referrerpolicy="strict-origin-when-cross-origin"` (the rest of the app keeps its policy).
- Some videos refuse embedding (errors 101 and 150): those show **Watch on YouTube** instead (the key, when set, says so in advance).

Help > What leaves your server says it: playing a video contacts YouTube from the viewer's browser.

## Reviews from the time, in detail

From Wikipedia's `{{Video game reviews}}` box on the game's article (found from the catalog's link to the article, or from Wikidata): each outlet's short name (EGM, GPro, NP, Fam, GSpot, IGN...) to its full name, the score as printed, and the citation behind it: its date, its magazine, volume, issue and page, its link and archived copy. Then:

- **A magazine review the owner has:** the citation's issue and page find the issue in the owner's library, and the review opens in the reader at that page. That's the owner's example: Super Metroid's EGM review opens at EGM June 1994, page 28, in their own scan.
- **One they don't have:** the citation's own link (often a public scan at the page, on the Internet Archive or Sega Retro), and the issue offered as **wanted**.
- **A web review:** its archived copy (Wikipedia's archive link, else the Wayback snapshot nearest its date), with the date shown.
- These also **seed the magazine mentions** of [magazines.md](magazines.md)'s third phase: exact issue and page for thousands of reviews before any OCR, and a check on the scores OCR reads.

## Learn more: the reference sites

**Reference sites** is a setting like Shop links: each line a site's name, its Wikidata property (or a link with `{title}` for sites Wikidata doesn't cover), and its group, with switches. Wikidata gives each site's link format, so the list writes itself from the game's identifiers: a site shows only when the game has a page there. Suggested on: Wikipedia, MobyGames, GameFAQs, StrategyWiki, HowLongToBeat, Giant Bomb, the console's fan wiki (Fandom), VGMdb (its music), speedrun.com, The Cover Project (box art), Retromags (its ads). The owner adds or removes any.

## Where it lives in the menu

Two new sections, each saying what it's for under its name, as the Stash, Acorns and the Nutshell do:

- **Magazines** (its own section, the owner's call): the library, reading, the issues owned and wanted, search. ([magazines.md](magazines.md).)
- **History** ("Games as they were, and as they're remembered"): **Time machine**: pick a month (June 1994): the magazines of that month, the games that came out, the reviews published, the videos of the time, the consoles on sale; **Timeline** (today's, moved here); **Consoles' histories** and their **Top 100s** (today they're under the Nutshell's Platforms; they'd be linked from both); **Videos**: the newest from the owner's channels about games they have or want.

The game drawer's **History** part is where the two meet. Today's "Past releases" (games released around this date in past years) would gain "and what the magazines said that month".

## Data to keep (additions)

| Table | What it keeps |
| --- | --- |
| `game_refs` | Per game (its IGDB id, else catalog title key): its Wikidata item, Wikipedia article, the identifiers on other sites (JSON), the first release date used for the two views, when it was read |
| `game_reviews` | Per game: outlet, score as printed, date, magazine issue and page (when a magazine), the review's link and archived link, source (Wikipedia, the owner, a magazine page), and the linked magazine page when the owner has the issue |
| `video_channels` | The settings' channels resolved: YouTube's channel id, uploads list id, the last look |
| `game_videos` | Per game: YouTube video id, title, channel, published date, kind (review, retrospective, documentary, trailer, commercial), At the time or Looking back, source (channel index, IGDB, Wikipedia, the owner), status (linked, suggested, rejected), embeddable, refreshed (YouTube's 30-day rule) |
| `archived_pages` | A page's address, the Wayback snapshot found and its date |
| the magazines tables | as in [magazines.md](magazines.md) |

## Settings (every choice one)

Settings > Features: **History** (the links and Reviews from the time; on: Wikipedia and Wikidata only), **Videos** (off until turned on), **Magazines** (off). Settings > History: the window for **At the time** (18 months), **Reference sites**, **Video channels**, how many videos a game shows, which kinds, **Play videos in Squirrelcade or on YouTube**. Settings > Sources: the YouTube Data API key (optional). Help > What leaves your server, updated for each.

## Phases, in the order recommended

1. **The game's identity, Learn more, Reviews from the time, and where it came from** (medium; no keys). Keep each game's Wikipedia article (the catalogs already read it) and Wikidata item (from its IGDB id); the Reference sites setting; Wikipedia's review table with dates, issues and pages; archived copies; **Inspired by and Inspired** from the article's development and legacy sections, the games named there linked. The game drawer's History part with both views (most of At the time already: scores and dates, archived reviews). The foundation the rest builds on.
2. **Magazines, phase 1: the section, collecting and reading** ([magazines.md](magazines.md)), as the owner gathers the scans. With phase 1 done, **Reviews from the time opens the owner's own scans at the page** wherever Wikipedia names the issue and page: the Super Metroid example works here, before any OCR.
3. **Videos** (medium). Without a key: pasted videos, IGDB's trailers, Wikipedia's cited videos, channels' newest uploads, Search this channel. With a key: whole channels matched, Review > Videos. The player with full screen, the referrer fix, the thumbnail first.
4. **Magazines, phases 2 and 3:** text, search, the games on every page and tapping them (magazines.md).
5. **The History section:** the Time machine (a month at a time), the Timeline and console histories moved in, the game's own timeline strip, Past releases with what the magazines said.

## For the owner to decide

1. The sections' names and marks (Magazines, History, or squirrel-themed names, as Stash and Acorns are).
2. The starting video channels: which are on, which listed (the table above).
3. A YouTube Data API key: worth making (a free Google Cloud project) for whole channels, or start without one.
4. The At the time window (18 months after release to start).
5. The phase order (above), and whether phase 2 (magazines) comes first while the scans are gathered.

## Research notes (2026-10-23)

- Wikidata, queried by Super Metroid's IGDB id: 107 external identifiers, each with its site's link format (property P1630), Retromags (P12948) and the MobyGames, GameFAQs, GameSpot, Giant Bomb, StrategyWiki, HowLongToBeat, VGMdb, speedrun.com ids among them.
- Wikipedia's Super Metroid article: a review table of 26 outlets, magazine citations with issue and page and Internet Archive scans at the page, 78 citations with an archived copy, and a GameTrailers retrospective cited as video.
- The Wayback Machine's availability API found GameSpot's 1990s Super Metroid review address archived (a 2011 snapshot).
- YouTube Data API: search costs 100 units, an uploads page 1 unit, 10,000 units a day free; its policies ask for API data to be refreshed or deleted within 30 days.
- YouTube embeds fail with error 153 without the page's address (late 2025); `strict-origin-when-cross-origin` on the frame fixes it.
- Retromags' game page for Super Metroid: its ads and release details, not a list of reviews.
- Wikidata's "influenced by" (P737): 51 video games in all; Super Metroid has none, but its genre (Metroidvania) and series are there. Influence lives in Wikipedia's articles.
