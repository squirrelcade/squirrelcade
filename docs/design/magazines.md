# Magazines: a library of scanned game magazines, read, searched and linked to the games

**Status: planned, not built** (the owner's idea, 2026-10-21; logged in [IDEAS.md](../IDEAS.md) and the plan's "Later" list). A design to pick up later; nothing here is decided until it's built.

## What it's for

The owner keeps scans of old video game magazines (Nintendo Power, EGM, GamePro and the like) on a NAS share. Squirrelcade would:

1. **Keep the library:** each magazine and its issues (title, number, cover date, publisher, cover), the scans left where they are, and the physical copies the owner has (or wants), like any other collectible.
2. **Read them:** page by page, comfortably on a phone.
3. **Read their text:** OCR on each page, searchable across every issue ("every mention of Chrono Trigger"), and what the pages are (reviews with their scores, previews, cover stories, guides, codes, ads).
4. **Tap the games on a page:** while reading, each game the page names is outlined where it's printed; a tap brings up its card on top of the page: whether you own it (which copies, where they're kept), where it is in RomM to play, and its details, without leaving the page.
5. **Link the games:** on a game's page, **In the magazines**: every issue and page about it, what kind of coverage, the score, and a tap that opens that page; on an issue's page, the games it covers, marked owned or wanted.

As with everything in Squirrelcade, it's an optional part (Settings > Features, off to start with), it works without any outside service, and every choice below is a setting with a neutral default.

## The data model (first cut)

Tables in Squirrelcade's database, beside the collection's:

| Table | What a row is | Main columns |
| --- | --- | --- |
| `magazines` | A magazine title | name, publisher, country, years, **platform focus** (console keys, such as the Nintendo consoles for Nintendo Power: it narrows game matching), its issue numbering (number, volume and number, or by date) |
| `magazine_issues` | One issue | magazine, number as printed ("Vol. 45", "#70"), cover date (year and month), cover story, page count, **the scan**: its path under a magazines folder (never copied), kind (PDF, CBZ/CBR, a folder of images), size and hash (to notice a replaced file), and, if the owner uses another reader, the same issue's link there (Komga or Kavita); OCR state (not yet, done, failed, which engine, when) |
| `magazine_pages` | One page of an issue | issue, its place in the file, the printed page number when read, width and height, **the page's text** (from the scan's own text layer or OCR), OCR confidence, **what the page is** (cover, contents, review, preview, feature, guide or map, codes and tips, letters, ad, other) |
| `magazine_pages_fts` | Full-text search | SQLite's FTS5 over the pages' text (the database is SQLite already): fast phrase search, ranked, with highlighted snippets |
| `magazine_mentions` | A game on a page | page and issue, **the title as printed**, where on the page (a box: the words that matched, or one the owner drew; it's what the reader outlines and makes tappable), the game it's linked to (see below), the console if the page says one, **kind** (review, preview, cover, guide, code, ad, mention), **score** as printed ("8.5", "4/5", EGM's four reviewers' scores as a list) and its scale, **confidence**, **how** (exact title, another name, fuzzy, the AI model, the owner), **status** (linked, suggested, rejected) |
| `magazine_rules` | The owner's answers, remembered | a printed title (per magazine or for all) → a game, or "not a game" ("ZELDA III" is A Link to the Past; "Rampage" in a letter isn't the game); applied to every issue, and again after a catalog changes |
| `magazine_copies` | A physical issue the owner has | issue, condition (sealed, complete, loose), **what's with it** (poster, cards, inserts, a strategy guide supplement), price paid, value, the day bought, notes; it gets a copy key so places, tags, photos, tests and loans work as they do for games |
| `magazine_wants` | An issue the owner is after | issue, a note, how much they'd pay |

**Linking a mention to a game.** A magazine often doesn't say the console (a preview of a multi-platform game). A mention is linked to the game itself: its IGDB id when Squirrelcade knows it, else its matching title key (the same keys the catalogs use), plus the console when the page names it. A game's page then lists the mentions of that game whichever console's page it's on; with the console known, it shows the console beside the score.

## Reading

**A reader built into Squirrelcade, from open-source parts** (the owner, 2026-10-21: not necessarily Kavita; an open-source reader installed locally, no integration needed). It's what makes "open straight to that page, with the words marked" work from search and from a game's page, and it needs nothing else installed:

- **Pages drawn on the server:** a CBZ or CBR is pictures already; a PDF page is drawn by **MuPDF** (`mutool draw`, AGPL like Squirrelcade) or **Poppler** (`pdftoppm`, GPL), a few MB in the image, at the size the phone asks for, and kept in a small cache (oldest pages dropped, its size a setting). The phone gets a light picture per page instead of a 200 MB PDF.
- **A viewer made for phones**, with an open-source zoom library (**PhotoSwipe**, MIT, or **OpenSeadragon**, BSD, for very large pages): swipe between pages, pinch to zoom, double tap to fit a column, the page number and the issue's contents in a strip, two pages side by side on a wide screen (a setting), the next page drawn ahead. A search hit or a mention opens it **at that page, with the words highlighted** (from the OCR's boxes).
- **Reading position** kept per issue, so an issue opens where it was left.
- **Another way for PDFs that have their own text:** **PDF.js** (Mozilla, Apache 2.0) draws PDF pages in the browser with a selectable text layer. Heavier on a phone for big scans, so a choice for later rather than the start.

**Other readers, optional, as links only.** For an owner who already reads elsewhere, an issue can also carry an **Open in...** link, set up on Settings > Magazines, nothing more:

- **Komga** (MIT; comics, magazines, PDF and CBZ): its reader opens at a page from the link (`/book/<id>/read?page=12`).
- **Kavita**: its reader links have no page; it opens where its reading progress is (its API can set that progress first, at the cost of moving the owner's place).

So no other reader is required, and none is integrated: the files stay where they are, and any reader the owner likes can read the same folder.

### Games on the page

The owner's idea (2026-10-21): "recognize where games are, and you could kind of click it... on top of whether or not I own the game, where it is in RomM, and additional details."

- **Where:** the OCR gives each word's box on the page, so each mention keeps the box around its title (the words that matched, joined). The reader draws those boxes over the page, faintly, colored by the answer Store Mode gives: green for one you have, gold for one on the wishlist, grey for the rest; a button hides them for plain reading.
- **A tap opens the game's card on top of the page** (a sheet from the bottom on a phone, a popover on a computer), from the answers Squirrelcade already has:
  - **Have it, or not:** your copies (condition, value, where each is kept), owned on another console or on PC, or Need it with its acorns and place on the wishlist;
  - **RomM:** where the game is in RomM, with **Play** to open it there (the link Store Mode and the Top 100 already show when RomM is set up);
  - **What the magazines said:** this page's score, and the game's other mentions ("also in EGM #70, p. 42");
  - **Details:** cover, release date, genres, reviews, and the full game drawer one tap further; **Add it**, **I bought it** and price links as in Store Mode.
- **What OCR can't read** (a game's name only in its logo, a screenshot, box art): in a **mark games** mode the owner draws a box on the page and picks the game; it's kept as a mention from the owner (confirmed), with its box. Later, the AI model (if set up) could suggest boxes for logos and box art on review pages.
- **An uncertain match** shows a dotted outline: a tap offers **This is it** / **Another game...** / **Not a game**, the same answers as Review > Magazines, right on the page.

## OCR: reading the text at home

**First, the text a scan already has.** Many scans come with a text layer (the Internet Archive runs ABBYY on what it holds; many PDFs were made searchable before they were shared). Squirrelcade reads that first (`pdftotext`, or MuPDF), checks it looks like real words, and uses it: no OCR at all for those issues.

**Otherwise, an engine that runs on the server's processor.** The design assumes no graphics card AI can use (a mini PC with a laptop processor, as the owner's server is). Options:

| Engine | How it would run | Good at | Not so good at | Rough cost per 100 pages* |
| --- | --- | --- | --- | --- |
| **Tesseract 5** (alone, or through OCRmyPDF, which also writes a searchable PDF beside the scan) | A package in the image (~30 MB with English) | Fast on the processor; boxes for each word; well known | Magazine layouts (columns, text on pictures, stylized headings): needs its page layout modes, and loses some headings | ~3 to 8 minutes, 4 threads |
| **PaddleOCR**, its ONNX models, in Node | onnxruntime-node with the PP-OCR models Check a shelf already uses on the phone (~30 MB) | Text in odd places and fonts (headings, boxes, screenshots' captions); no Python | Slower on the processor; reading order across columns needs its own sorting | ~6 to 15 minutes, 4 threads |
| **Surya** (layout and reading order) | Python, a sidecar container | The best layout and reading order of the three | Slow without a graphics card; a heavy install | ~30+ minutes |
| **A vision model** (the AI model set up for Check a shelf, or the owner's helper) | One question per page | Understands a page: which game a review is about, its score, a guide's maps | Cost or the owner's plan's usage per page; slow on a processor at home | a model's cost; not for whole issues |

\*Estimates from published figures and the shelf-scan measurements, not yet measured on magazine scans: Phase 2 starts by timing two or three real issues (a Nintendo Power, an EGM, a GamePro) on the server, as Check a shelf was measured before it was built. A 300-page EGM costs three times a 100-page Nintendo Power.

**The recommendation to measure first:** the scan's own text where there is one; Tesseract (through OCRmyPDF, so each scan also gets a searchable PDF the owner can keep) for the rest; PaddleOCR's models as the second pass for pages where Tesseract's confidence is low (headings and boxes). The vision model only in Phase 3, only for the pages that look like reviews (a few per issue), and only if the owner sets one up.

**Running it:** a background task, **Read magazines' text**, a few issues a night in a window (Settings > Tasks: the hours, the threads, at a lower priority so Plex and the rest come first), resuming where it stopped. A library of 500 issues of about 150 pages is some 75,000 pages: about 40 to 60 hours of background work with Tesseract, so a few weeks of nights, newest-added first. Text is small (5 to 10 KB a page, so about half a gigabyte with its index for that library); page pictures aren't kept, only drawn and cached.

## Matching: titles to games, and the owner's corrections

1. **Finding candidates:** the page's text is checked for the titles Squirrelcade knows (every catalog's games and their other names, IGDB's names), as its title matcher already compares them (numbers either way, articles and subtitles aside), **limited to what the issue could be about**: the magazine's consoles, and games out within a window around the cover date (two years before to a year after, a setting; previews come before release), with a "retro" exception for features about old games.
2. **Scoring each one:** where it is (a heading, a review box, the contents page count more than a passing word), how often it's named on the page and the pages around it, a console named beside it, how unusual the title is (short or common titles, "Rampage", "Heat", "Pong", need a heading or a score box before they count), and the owner's rules.
3. **What happens:** at or above **Link games found at this confidence** (0.85, the same bar Claude's connector uses for "the same game") a mention is linked; between that and **Ask me about games found at** (0.6) it's a suggestion on **Review > Magazines**; below, it's dropped. A review page that names a score links its score too.
4. **The owner's answers stick:** Review shows the page with the words marked, and **This is it** / **Not this game** / **Another game...** / **Not a game**. Each answer becomes a rule for that printed title (per magazine, or everywhere), applied to every issue at once; a rejected pair is never suggested again. Catalog changes (a new console, a new name) re-check the suggestions, never the owner's answers.
5. **Precision on the game's page, recall in search:** In the magazines lists linked mentions only (a suggestion shows as "maybe" under them); search finds every word whether linked or not.

**Scores and kinds.** Each magazine lays out its reviews its own way (EGM's Review Crew with four scores; Nintendo Power's ratings for graphics, play control and fun; GamePro's faces and scores). The first pass is rules per magazine (the shapes of their score boxes, as patterns in a file the owner can extend), then the vision model, if one is set up, for review pages the rules don't read. A page's kind comes from the contents page, its heading words, and those patterns.

## Phases

**Phase 1: the library and reading.**

- The magazines folder (Settings > Magazines; a mounted NAS share, like Playnite's folder), read on a schedule: each PDF, CBZ or CBR becomes an issue, the magazine and number taken from its file name ("Nintendo Power 045 (Feb 1993).pdf", the way most collections name them) and its first page as the cover; anything it can't read goes to a list to name by hand.
- Magazines and issues by hand too; a CSV of issues (title, number, date) to load a run at once.
- The built-in reader (above), and an optional Open in Komga or Kavita link.
- Physical copies (condition, what's with it, price, value, photos, place) and wanted issues, with their own lists; the Stash's totals leave them out unless a setting says otherwise (they aren't games).
- Where it lives in the menu: the owner's call when it's built (its own section with its own mark, or under the Nutshell beside Platforms and Sets).

**Phase 2: text and search.**

- The scan's own text, then OCR (Tesseract, measured on real issues first), as the background task above; each page's text kept with its boxes.
- **Search magazines:** a page of its own and a tab in the header's search: phrase search across every issue, filters (magazine, years, page kind), results as page thumbnails with the words highlighted, each opening the viewer at that page.
- A searchable PDF written beside the scan, if the owner wants (a setting: off, beside it, or in another folder), for reading elsewhere.

**Phase 3: the games.**

- Title spotting, scoring and the Review queue (above); page kinds; scores by the magazines' patterns, then the AI model for what's left, if set up.
- **Games on the page** in the reader: their outlines, colored by whether you have them, and the game's card on a tap (have it, where it's kept, RomM, the magazines' scores, details), with a mark-games mode for logos the OCR can't read.
- **In the magazines** in every game's drawer: issue, page, kind, score, a thumbnail, opening at the page; the issue's page lists its games (owned, on another console, on the wishlist, with acorns).
- The rest of Squirrelcade uses it: Store Mode can show "EGM gave it 8.5" beside a game you're looking at; the wishlist can take magazines' scores as a rule (a setting, off by default); Claude's connector and Talk can answer "what did Nintendo Power say about it?".

## What could start the lists (sources)

- **The scans themselves:** their file names, and their text layers (the Internet Archive's magazine items carry ABBYY's OCR, with full text and hOCR downloads).
- **Wikipedia's "Video game reviews" boxes** on game articles list magazines' scores (EGM, GamePro, Nintendo Power, Famitsu...) per game, CC BY-SA, read as Squirrelcade already reads Wikipedia's game lists: no page numbers, but a check on the scores read from the pages, and a hint of which issues reviewed a game.
- **Fan wikis' per-issue pages** (the Nintendo Fandom wiki has a page per Nintendo Power volume with its articles and reviews; CC BY-SA, through the MediaWiki API, with credit): an issue's contents to seed its mentions.
- **Retromags** keeps a database of some 35,000 magazine records with issue pages, and many scans; no API or terms for automated use were found, so it's a source to read by hand, or to ask Retromags about first.
- **The Video Game History Foundation's digital archive** has text-searchable scans of EGM, GamePro and more, with OCR built for magazine layouts; for reading online and checking, not a feed.
- **Transcribed review lists** (Tanooki Site's classic Nintendo Power reviews, issues 45 to 100) as a check on Phase 3's scores.

Squirrelcade never downloads or shares scans: it reads the owner's own files, and what it learns from them stays on the server.

## Still to decide when it's picked up

- Its place in the menu, and whether physical issues count in the Stash's totals.
- The zoom library (PhotoSwipe or OpenSeadragon) and MuPDF or Poppler, tried on the owner's phone with real scans.
- Which OCR engine, from Phase 2's measurements.
- Whether magazine scores ever feed the wishlist's acorns (a rule, off by default).
