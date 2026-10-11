# Shelf Scan: the plan

Proposed 2026-10-10 from the owner's own use: in a store, a photo of a shelf of games, which Claude read through the Squirrelcade connector, checking each spine against the collection. Not built; this is the design to start from.

## What it's for

A photo of a store shelf (spines facing out, usually one console) in, a checklist out: each game marked **have it**, **have it on another console**, **on your wishlist** (with its acorns), **missing**, or **unsure**. Any time, from a phone, ideally with no signal and no paid service. A game is never marked missing on a poor read: an unsure read is **unsure**, since a wrong "missing" is how a duplicate gets bought.

## What's already there

- **Store Mode** answers one game, by barcode or by title, and works with no signal from the browser's copy of every answer (`/api/v1/lookup/offline`, D45).
- **Scan my shelf** (0.33.0) takes the barcodes of your own games at home, so Store Mode knows them at once later.
- **Check a list** answers a pasted list of titles, line by line.
- **The title matcher** (`packages/core/src/titleMatch.ts`, 0.55.0, D127) was written for exactly this kind of text: titles from a photo, a list or a conversation. It gives each match a confidence (0.85 and up is the same game, 0.6 to 0.85 a near miss that's listed and never counted), reads editions, subtitles, franchise names and spellings, and treats a different number as a different game. The Claude connector's `check_ownership` (`apps/server/src/aiTools.ts`, behind `mcp.ts`) uses it, and since it's in `packages/core`, the phone can run the same code.
- **Claude with the connector or plugin** (Help > Claude and AI apps) already does Shelf Scan today, with AI: the photo goes to Claude, which reads the spines and asks `check_ownership`.

## Can it work without AI?

Partly, and the honest answer shapes the design.

- **The phone's own text recognition isn't open to web pages.** iPhone's Live Text and Android's ML Kit work in apps, not in a browser. Chrome has a `TextDetector`, but it's still experimental and depends on the platform. A web app (and Squirrelcade's phone app is one) has to bring its own text reader.
- **Tesseract.js** (the classic OCR, in the browser) is made for documents: dark horizontal text on a light page. Spines are the opposite: vertical, stylized logos, coloured bands, glare, thin, often far from the camera. Expect it to miss many spines and misread others. It would still settle some, because of the closed list (below).
- **Scene-text models** (PaddleOCR's PP-OCRv5 mobile models, run in the browser through ONNX Runtime Web; community packages exist) are made for text in photos, at any angle, and do markedly better on signs and labels. It's machine learning, but it runs on the phone, costs nothing per scan, sends nothing anywhere, and works with no signal once its model files (tens of megabytes) are downloaded and cached. Stylized logos (a franchise's wordmark) and distant thin spines still defeat it.
- **The closed list is what makes it work.** On one console's shelf, a read only has to pick among that console's known games (one to three thousand, from its checklist, other names and your own copies' titles), so a partial read like "NCHARTED 2 AMONG TH" is enough. Store Mode's offline copy already keeps that list on the phone.
- **Precision before recall.** Only a match at 0.85 or more counts; a number has to be read (Halo 2 against Halo 3: an unread or doubtful digit makes it unsure); everything else is unsure, with its best guesses offered.
- **What to expect** (to be measured, not promised): on a well-lit photo of one console's shelf, a scene-text model with the closed list might settle half to three quarters of the spines, the rest unsure; Tesseract noticeably fewer. Phase 1 measures it on real photos before anything is chosen.

So the answer is a **hybrid**: on-device reading and the closed list by default (free, private, offline); the barcode for one game in hand (exact; Store Mode already does it); and AI only for the spines left unsure, only if the owner turns it on, only with signal.

## How it would work

1. **Capture (phone).** Store Mode > **Shelf Scan**: pick the console (the last one by default), then take a photo or choose one (a file input with the camera as its source works in every phone browser and in the installed app). The photo stays on the phone.
2. **Read (phone, in a background worker).** Find the text boxes; read each one upright and turned (spines are mostly vertical); group the boxes into spines by where they sit; make a few candidate strings per spine (each line, and neighbouring lines joined).
3. **Match (phone, `packages/core`).** Against the console's closed list from the offline copy, with the title matcher plus a layer for reading mistakes (O and 0, I and 1 and l, S and 5, rn and m, a dropped letter). Each spine gets the offline copy's answer: have it, have it on another console, on the wishlist with its acorns, missing, not a target. Online, the server can run the same code; it's one matcher either way.
4. **Show.** A checklist: **Need it** (wishlist games first, by acorns), **Have it**, **Have it on another console**, **Unsure**. Later, the photo itself with each spine's box coloured by its answer; tap one to fix it (search the console's games, or "not a game"). A fix is remembered (this spine's text is that game) for the next scan, in the offline copy, as Scan my shelf remembers barcodes. **I bought it** works from the list.
5. **AI fallback (optional, off by default).** With signal and a key the owner adds, only the unsure spines' crops (never the whole photo) go to a vision model, which returns the text it reads; Squirrelcade matches that as in step 3, so the model never decides ownership. A cap on crops per scan and per day keeps the cost known. It runs inside Squirrelcade, from its server: a phone that reaches Squirrelcade (at home, or through whatever remote access its owner set up) gets it, against the live collection, with nothing more opened to the internet. Claude in its own app can't do that from a store when the connector only answers at home (its remote sign-in is off by default, D130): the owner's store test ran on an export weeks old, and four of its "not in your collection" games had been bought since.

## Title data needed per console

- **The console's game list:** its checklist (Wikipedia and the owner's lists), its games' other names, and your copies' titles. All there already, and in the offline copy.
- **Short names as spines print them:** many spines show only the main title or a logo ("UNCHARTED 2", no subtitle). The matcher's base-title and subtitle handling covers part; IGDB's alternative names (the optional IGDB layer) would cover more.
- **Learned spine texts** from fixes, per install.
- Nothing from a photo is kept unless the owner saves the scan.

## First measurement (2026-10-10)

Six phone photos of a used-game store's PS3 shelves and glass case (sent shrunk to about 1.2 megapixels; the phone's originals are about 12), each read upright and turned both ways, at its size and doubled, then matched against the owner's PS3 checklist (1,156 games) with tolerant matching: spaces ignored (readers run words together), small letter slips forgiven, a title's number read exactly or the read is unsure (II is never III), a read that could be the cut-off start of another game unsure (DARKSIDERS could be Darksiders II). Scripts in the owner's `.work/ocr`.

| | Tesseract.js | PaddleOCR (PP-OCR models through ONNX Runtime) |
| --- | --- | --- |
| Games identified for sure | 5 | 50 |
| Wrong "for sure" | 0 | 0 (each checked against the photos) |
| More, unsure with a close guess | 2 | 28 |
| Reading time, six photos, every pass (PC) | 84 s | 35 s |

Against Claude reading the same photos (the owner's run through the connector): of the 11 PS3 games on those shelves that the owner doesn't have, Claude named all 11; the reader named 1 for sure (Class of Heroes 2G) and 3 more as unsure with the right guess, and missed 7, mostly thin spines and stylized logos. Claude also added what reading can't: prices against PriceCharting, editions (a collector's edition of a game owned), notes.

A second photo, of the owner's own Switch 2 shelf at about 5 megapixels (2576 × 1932): of roughly 80 Switch 2 spines, 36 identified for sure, all right (all owned, as they had to be), 7 unsure, 6 of them with the right guess. A first version of the matcher called a bare "NINTENDO" Nintendo Switch Sports Resort, a game not owned: the start of a title now counts only when it's most of the title, with no number left unread. Matching also drops a title's console edition and bundle ("- Nintendo Switch 2 Edition + Star-Crossed World"), which spines often leave out. Missed: stylized logos (NBA 2K26, EA FC 26, WWE 2K25), Japanese-language spines (the checklist has English titles only), the smallest print.

What it showed:

- Tesseract is out; a photo-text model like PaddleOCR is the one to build on.
- With no false answers and about a third of a shelf at this size, on-device reading is useful but not complete. Full-size photos are the next test (text three times taller).
- The closed list has holes: three PS3 games on the shelf (Captain Morgane and the Golden Turtle, World of Outlaws: Sprint Cars, Rock Band Track Pack: Classic Rock) aren't on the owner's checklist, so no reader could call them missing. Shelf Scan should match against the console's full known list (the checklist plus IGDB's or PriceCharting's names), and say "not on your checklist" when that's the case.
- After a game is identified, much of Claude's extra is Squirrelcade's own data: the copy you have and its condition, your note, the edition you own, its acorns. Prices of games you don't have are the gap (Squirrelcade only has values for copies you own and deals).

## Phases

0. **Today, nothing to build:** the Claude app with the connector or plugin does this with AI. Write it up in Help > Store Mode as the way to do it now.
1. **Measure:** 20 to 30 real shelf photos (the owner's, kept out of the repository), a test page running Tesseract.js and PaddleOCR on them; count spines read right, wrong and unsure; time and download size on a phone. Choose the engine on those numbers.
2. **MVP:** Store Mode > Shelf Scan: one photo, one console, on-device reading, the checklist (no overlay yet), working offline after first use, I bought it from the list.
3. **Overlay and fixes:** the boxes on the photo, tap to fix, fixes remembered.
4. **AI fallback:** opt-in, unsure crops only, the owner's own key, with caps.

## Settings (every decision is a setting)

- Shelf Scan on or off (on with Store Mode).
- How sure a match must be to count (0.85).
- When to download the reading model: on first use, or only on Wi-Fi.
- AI fallback: off; which service and its key; at most so many crops per scan and per day.
- Keep scans: off.

## Open questions

- Which engine: phase 1 decides.
- Mixed shelves: the first version asks for the console; later the spine's console band (PlayStation's blue, Switch's red, Xbox's green) could tell.
- Shelves shot at an angle, or two rows in one photo: guidance on the capture screen first, correction later if the measurements call for it.
