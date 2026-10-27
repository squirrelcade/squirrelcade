# Leaves: your magazine scans

**Leaves** keeps your scanned game magazines (Nintendo Power, EGM, GamePro and the like): each magazine and its issues, a reader for any screen, and their text searched. The scans stay where they are: Squirrelcade only reads them, and what it learns from them (each issue, each page's text) is kept in its own small database, rebuilt from the scans if it's ever lost (so it's left out of backups).

## Setting it up

1. Keep each magazine in a folder of its own, its issues as **CBZ** files (a zip of the pages' pictures), each with its `ComicInfo.xml` (the file Kavita and Komga read: the magazine, its number, its year and month, the cover story). An issue without one is named from its file name, as `Nintendo Power #045 (1993-02) Star Fox.cbz`.
2. Add the folder to the compose file, **read-only**, and recreate the container:

   ```yaml
       volumes:
         - /path/to/Magazines:/magazines:ro
   ```

3. **Settings > Features:** turn on **Leaves: your magazine scans**. In Docker, Squirrelcade looks in `/magazines` by itself; **Settings > Magazines** has the rest.

Squirrelcade reads the folder a few minutes after it starts and then every night (**Read the folder now** on Leaves does it at once). The first time it reads every issue's table of contents and `ComicInfo.xml` only (a few kilobytes each, never the whole scan), so even a big library is read in minutes; after that, only the files that changed. Folders and files starting with `_` or `.` are left out (**Folders and files to leave out**).

## Reading

**Leaves** in the menu shows your magazines as covers, with how many issues and their years. A magazine shows its issues by year; an issue opens the **reader**: a page at a time on a phone, two side by side on a wider screen (**Two pages side by side on a wide screen**, as they were printed), turned with the arrows, your keyboard's arrow keys or a swipe; the zoom buttons (or a double tap) to read the small print. The next pages are fetched ahead, and Squirrelcade remembers the page you were on in each issue. Each page is sent as wide as your screen needs (a phone gets a much smaller file than the scan, a cover tile a tiny one), made once on the server and kept in the config folder's magazines-cache, so pages open fast on the phone; **Largest page sent** and **Room for the pages made** (Settings > Magazines, after Show advanced) set how wide and how much room.

**Name these**: issues whose files don't say when they came out are listed there (a link on Leaves); give each its month and year, and it takes its place among its magazine's years. Before that, Squirrelcade dates what it can itself: from its magazine index (GameFan's volumes and issues, for now) and from an issue's number between two dated issues of its magazine that came out one a month (Computer Gaming World's #41 between #40, October 1987, and #43, January 1988). Those are listed under **Dated by Squirrelcade** on the same page, to check; give one another date if it's wrong, and yours is kept.

## The games in the magazines

Squirrelcade finds the games your issues talk about, two ways, once a day (System > Tasks: **Find the games in the magazines**):

- **The reviews Wikipedia cites.** A game's Roots reads its Wikipedia article, whose review table cites magazines by issue or date and page ("EGM, June 1994, p. 28"). When you have that issue, the review shows **Open your scan** on the game's page and opens it there. A printed page number and the file's page can differ (covers, inserts): turn to any page in the reader and type the number printed on it in the **p.** box once, and the issue's page numbers line up.
- **The games named on the pages with text.** Each page's text is checked for the games the issue could be about: the magazine's consoles (Nintendo Power's are Nintendo's; Settings > Magazines > **A magazine's consoles**) and the games out from two years before its cover date to a year after (**Games an issue could be about**). A long title found counts more than a short one, big type (a heading) and a title named twice more again. From **Link games found at** (0.85) a game is linked; from **Ask me about games found at** (0.6) it's a maybe. EGM's Review Crew scores and Nintendo Power's ratings on a review page go with the game reviewed.

**On the page:** **Games** in the reader shows each game's outline: green you have it, blue on another console, gold on your wishlist, grey none, dotted for a maybe. Tap one for its card: whether you have it, **Play on RomM**, this page's score, where else your magazines mention it, and the game itself. A maybe's card asks **This is it**, **Not this game** or **Not a game**; your answer is kept for those words in that magazine, in every issue. **Mark a game**, then draw a box around a logo or box art the text can't read, and pick the game. **In this issue** under the reader lists them all by page.

**Review > Magazines** (Leaves' menu, and a link on Review) lists every maybe, the surest first, to answer the same way.

On a game's page, **In your magazines** (in its Roots) lists its reviews and mentions in your scans, each opening at its page; Now in and the Time machine show its reviews beside it.

## Searching

**Search** finds every page whose text has your words (or a phrase, in quotes: `"Chrono Trigger"`), best first, with the words marked; filter by magazine or years. A result opens the reader at that page with the words marked on it.

A page needs its text to be found:

- **Text that came with the scans**: if your scans were read by Tesseract already (its hOCR, one file per page, in `<magazine folder>/ocr/<issue>/001.hocr`...), Squirrelcade takes it as it is from **Text already read** (to start, `_derived` in the magazines folder): the issue a folder is is the number at the end of its name (`NP-010` is #10).
- **Read the rest of their text at night** (off to start): [Tesseract](https://github.com/tesseract-ocr/tesseract), in Squirrelcade's image, reads the pages that have none, newest issues first, in the **Reading hours** (1 AM to 6 AM to start), on the **Processor cores it may use**, at the lowest priority so everything else comes first. After its first issue, Leaves says how long the rest will take. A big library is weeks of nights: that's expected.

## Who sees them

Your magazines are yours alone unless **People you invite can read them too** is on (Settings > Magazines).
