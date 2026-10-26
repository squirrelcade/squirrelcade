# Magazines (Leaves): the build plan

The design is [magazines.md](magazines.md); this is the plan to build it, written 2026-10-25 after reading the owner's own magazine folder (the owner: "I want you to go scan it and come up with an implementation plan for the magazines. Based off what you see"). The owner's paths stay in `private/`.

## What the owner's folder holds

- **11 magazines, 1,512 issues, about 225 GB**, every one a **CBZ** (JPEG pages, `001.jpg`...): Computer Gaming World 256, Electronic Games 34, Electronic Gaming Monthly 249, Game Informer 285, GameFan 88, GamePro 186, Next Generation 85, Nintendo Fun Club News 7, Nintendo Power 285, Official U.S. PlayStation Magazine 21, PlayStation: The Official Magazine 16. One folder per magazine.
- **Every CBZ carries a `ComicInfo.xml`** (the owner's converter wrote it): series, number, volume, year and month, publisher, page count, the cover story as its title, language, the source file in its notes. So issues are named from it, not guessed from file names.
- **File names** follow one pattern: `Nintendo Power #001 (1988-07) Super Mario Bros. 2.cbz`, `Computer Gaming World #268 (2006-11).cbz`; GameFan by volume, `GameFan Vol 01 #01.cbz`.
- **Dates missing** for 76 of GameFan's 88 issues and 38 of Computer Gaming World's 256 (and 1 EGM, 2 Game Informer): these go on the **Name these** list with a cover date to fill in, unless the magazine index (below) knows them.
- **Text already read for 11 issues** (Nintendo Power #10 to #20, about 1,050 pages): Tesseract 5.5 hOCR and plain text, a folder per issue in `_derived/`, beside the magazines.
- **Working folders to skip**: `_work/` and `_derived/` (the converter's), anything starting with `_` or `.`; a `.kavitaignore` already lists them.
- **One issue didn't convert** (GameFan Vol 07 #04: a page wider than 65,500 pixels): not in the folder yet; nothing for Squirrelcade to do.

## Decisions taken from what's there

1. **The folder is mounted read-only** (`/magazines:ro`, like the Playnite folder). Squirrelcade writes nothing to the share: its page cache, covers, text and search index live in its own data folder (`magazines.db` and a `magazines-cache/` folder), rebuildable, left out of backups by default. No write permission is needed.
2. **CBZ first, with ComicInfo.xml as the source of truth**; file names only when an issue has no ComicInfo. PDF and CBR come later (none in the owner's folder).
3. **The library is read without opening 225 GB**: per CBZ, only the zip's directory and its small `ComicInfo.xml` (a few KB); a file is read again only when its size or date changes. The cover is drawn from page 1 the first time it's shown and kept (a small WebP), never all 1,512 at once in the scan.
4. **The text already read is taken as it is**: hOCR found beside the library (in `_derived/<magazine>/ocr/<issue>/`, a setting with that default) is imported for its issues, with its word boxes, so those issues need no OCR.
5. **OCR: Tesseract 5 with English**, the engine that read the owner's 11 issues (its hOCR gives each word's box, which the reader's highlights and later the games on the page need). In the image (about 40 MB). **Off by default**, on for the owner: a background task at night (hours a setting), threads a setting (default 2; the owner's server has 12 cores, so 4), at the lowest priority. It times the first issue and says how long the rest will take. Rough size: about 180,000 pages, so about one to two weeks of nights at 4 threads; measured, not promised.
6. **Pages are served as they are in the CBZ** (JPEG), resized to the phone's width and cached (cache size a setting, 1 GB to start), the next pages fetched ahead.

## The build, in order

1. **The folder and its settings.** `Settings > Magazines`: the folder (`/magazines`), folders to skip (`_*`, `.*`), the text folder, OCR (off, its hours and threads), the cache size, viewers can see magazines (off). The compose line, Help, the README and install guides (Synology, Unraid, TrueNAS), both AI setup prompts and the settings file the AI can write. On the owner's server: the read-only mount added to the container (a restart).
2. **The library.** A task **Read the magazines folder** (on start, then nightly, and a button): magazines and issues from ComicInfo, `magazines` and `magazine_issues` tables as in the design; **Name these** for what it couldn't date, the owner's answers kept. A small **magazine index** data file (each magazine's numbering and cover dates) to fill the missing dates, starting with GameFan and Computer Gaming World.
3. **Leaves in the menu**: its own section with its own mark (the design left it to the owner; this is the recommendation). Magazines as covers (each with its issue count and years), a magazine's issues as covers by year with the year bar (like the A–Z bar), an issue's page (cover, date, cover story, page count, Read).
4. **The reader**: swipe between pages, pinch and double-tap zoom (PhotoSwipe, MIT), two pages side by side on a wide screen (a setting), the page strip, the place kept per issue, opening at a page from a link (`?page=12`), with the searched words highlighted when it opens from a search.
5. **Text and search**: the hOCR import, then the OCR task for the rest; each page's text and word boxes in `magazine_pages`; SQLite FTS5 over them; **Search magazines** (a page, and a tab in the header's search): phrase search, filters (magazine, years), each result a page thumbnail with the words marked, opening the reader there.
6. **Tests** with small CBZs made during the test run (never real scans), and the timing budgets below.

**After this build** (the design's Phase 3, the owner's call when): the games on a page (outlined, tap for the game's card), **In the magazines** on a game's page, scores, physical copies and wanted issues.

## Snappy (AGENTS.md)

Every page of Leaves reads only the database and the cache. Budgets on the owner's server, timed before release:

- The magazines page and a magazine's issues: under 300 ms, covers from the cache.
- A page in the reader: under 500 ms the first time (resized from the CBZ over the NAS), under 100 ms once cached or fetched ahead.
- Search magazines: under 300 ms over the whole library's text.
- The folder's scan: in the background; the first one reads 1,512 small `ComicInfo.xml`s (minutes, not hours), later ones only changed files.
- OCR never in the day's hours, never above the lowest priority; the header search and a barcode lookup keep their budgets while it runs.
