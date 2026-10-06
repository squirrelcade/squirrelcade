# Adding games in Squirrelcade, and Squirrelcade as the hub

Written 2026-09-29 for the owner's review and revised the same morning after talking it through. **Decided** (the owner, 2026-09-29): Squirrelcade becomes the middle of the owner's collecting, with the other services around it; sending to them by hand through their own import pages is fine for now. **Built:** step 1, Squirrelcade keeping every copy (0.19.0, D81, D82), and step 2, adding copies and the PriceCharting round trip (0.20.0, D83; below). It's the roadmap's biggest item: today a copy exists in Squirrelcade only if a PriceCharting export (or an uploaded spreadsheet, or another collection app's export) has it, and **I bought it** only marks a game owned until the next export includes it.

The owner's aim: **Squirrelcade becomes where games are entered**, and the other services (PriceCharting first) are fed from it: PriceCharting for its prices and price history, the others as backups of the collection.

## What it should do

- Record a copy in Squirrelcade: from a game's drawer (**Add a copy**: condition, price paid, date, where it's kept), and from Store Mode (**I bought it** becomes "Add it to my collection", with the condition in one tap).
- Work for people without PriceCharting, and keep working for people with it: a later export must never erase a copy added here, nor count it twice.
- Keep every part of Squirrelcade seeing one collection (statistics, value, completion, Copies, the workbook).
- Send new copies to PriceCharting (and later other services) through their own import pages, so their prices come back with the next export.

## The round trip with PriceCharting (any account, free included)

PriceCharting's API (which can add to a collection) comes only with its $49/month Legendary plan, so it isn't part of the plan: Squirrelcade's users won't have it. Everything below works on a free account and on Collector ($6/month).

1. **Add in Squirrelcade.** The copy counts at once: completion, wishlist, Store Mode, spending (its price paid).
2. **Send to PriceCharting.** Squirrelcade keeps the copies added since the last send and writes them as PriceCharting's paste importer takes them, one per line ("Mafia III Xbox One CIB": title, console, condition), with a button to copy them and one to open pricecharting.com/collection-text-importer. PriceCharting says it matches about 90-99% of lines. (Its CSV importer takes PriceCharting product ids, which Squirrelcade has only for games that came from an export.)
3. **Export on PriceCharting** as usual; the email import picks it up. Each copy added here is matched to its copy in the export (below): from then on it has PriceCharting's product, value and price history. A copy the export doesn't have after a send is flagged ("not on PriceCharting yet: add it there by hand"), never dropped.

A free PriceCharting account allows **one import and one export a week** (paid plans: unlimited), so the rhythm is weekly: paste, then export. The weekly reminder can say both ("3 games to add to PriceCharting, then export"). PriceCharting's paste importer takes no price paid or dates: Squirrelcade keeps those as the master copy of them.

## Squirrelcade as a hub (later)

Where each collection service stands (checked 2026-09-29):

| Service | Into it (import) | Out of it (export) | What Squirrelcade could do |
| --- | --- | --- | --- |
| PriceCharting | Paste importer (title, console, condition), CSV importer (product ids); 1 a week free | CSV by email (1 a week free) | Both ways (above); its export already comes in by email. |
| CLZ Games | Text/CSV import on CLZ Games Web: the file's columns are matched to CLZ's fields, best with barcodes (the list of fields isn't published) | CSV | Read it (0.15.0); write a CLZ import file of the copies added since the last send. |
| VGCollect | CSV import of its own backup format (by its item ids, it seems; untested) | Backup CSV | Read it (0.15.0); writing needs VGCollect's ids, so likely not. |
| GAMEYE | No self-serve import (its team imports collections on request) | Spreadsheet (CSV) | Read it (0.15.0). |
| Backloggd | None official (community scripts drive the site with a session cookie) | None yet (on its roadmap) | Nothing safe to do. |
| Grouvee | None | CSV (shelves, ratings, dates, IGDB ids) | Read its export into What you played. |
| HowLongToBeat | Steam only (bulk import is an unofficial userscript) | CSV | Read its export into What you played. |
| Infinite Backlog | Digital stores only (Steam, PSN, Xbox, GOG, RetroAchievements), no CSV | CSV | Read its export into What you played. |
| Completionator | Steam, and a pasted list of games | Yes (format not checked) | A pasted list, like PriceCharting's. |
| Keep Track of My Games | Steam, Xbox, PSN, GOG; a spreadsheet through its Bulk Import "powerup" | CSV | Possible; low priority. |

So: **physical collections can go out to PriceCharting and CLZ**, the two with documented importers; play logs (Backloggd, Grouvee, HowLongToBeat, Infinite Backlog) take nothing in, but their exports can come into What you played. Every send goes through the service's own import page, clicked by the owner: no passwords stored, no scraping, within each service's terms. Most importers add and never remove, so a send is the copies added since the last one; a copy sold or removed is removed there by hand (Squirrelcade lists them).

## The options for the copies themselves

| | How | For | Against |
| --- | --- | --- | --- |
| **A. Copies of Squirrelcade's own, beside the imports** | A table of copies added here, merged into the current collection everywhere it's read. When an export brings the same game on the same console, the copy added here is matched to it (keeping its price paid, date and details), with an undo. | Small change to imports; a clear rule; no migration. | Every place that reads the collection learns to merge two sources (a single "current collection" view hides it). |
| **B. Squirrelcade as the master copy** | Every copy has a source (PriceCharting, spreadsheet, another app, Squirrelcade). An export adds and removes only its own source's copies; copies from elsewhere stay. | The long-term shape the owner described ("Squirrelcade is the hub"). | A migration of every copy; import safety checks and reports rethought; more testing. |

**Chosen: B** (the owner, 2026-09-29), in steps:

1. **Copies of Squirrelcade's own** (built, 0.19.0): a `copies` table, one row per copy with a key that never changes; each update matches its copies to them (the same product in the same condition, then the same game on the same console for a copy no file of its kind has), adds the new ones, and a copy its kind of file no longer has waits on Review > Copies (kept, sold or gone) unless Settings > Collection > Safety removes it with the update. A PriceCharting export takes over a copy it matches; a spreadsheet only Squirrelcade's own. Existing installs start their copies from the current update, the details kept under a product and condition staying with its first copy.
2. **Adding a copy** in Squirrelcade (a game's drawer, Store Mode's "I bought it"), and the PriceCharting round trip (above) (built, 0.20.0, D83: Add a copy, Change it, Sold or Remove, and Collection updates > Send to PriceCharting).
3. **What PriceCharting doesn't log** (built, 0.21.0, D84; the owner's list): a tested log; standard photos by the kind of game (a disc game: box front, back and inside, and the disc's two sides; a cartridge: its front and back; the slots a setting); estimated prices and dates for copies bought long ago, **for Squirrelcade's own sense of the collection only: never sent to another service nor written into an export as what was paid** (the owner); and an "improve your collection" list.
4. **Achievements** beyond RetroAchievements (built for Xbox and PlayStation, 0.24.0, D88): Xbox through OpenXBL, PlayStation through the PlayStation App's API (unofficial, opt-in). Steam's followed with the PC library (built, 0.28.0, D92).
5. **The other services:** the CLZ send, play logs' exports into What you played. The **selling helper** came first (built, 0.22.0, D86): listings for eBay and Mercari written from the copy, its price after fees, its photos, and each sale kept.

**Several copies of a game:** each is its own record (its condition, photos, tests, price paid); two complete copies of the same game were one set of details before 0.19.0. **The same game on several consoles or on PC** stays a copy per console, shown together on the Copies page and in the game's drawer ("You also have it on..."), as now.

## Details to settle

- **Value** of a copy added here: none until an export has it; the drawer says so. Price paid counts in spending right away.
- **Matching an export** to a copy added here: same console and the same catalog game (the catalogs' title rules), and the same condition when both say one; otherwise it asks on Review ("the copy you added, or another one?").
- **A spreadsheet or another app's upload** is a whole collection like an export: the same rule applies.
- **Viewers** see copies added here like any other.
- **Undo:** each copy added here can be removed from its drawer; an export that matches one says so in its report.
