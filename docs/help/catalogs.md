# Consoles, catalogs and completion

A console's **catalog** is the list of games there are to collect for it. Squirrelcade compares your copies with it to show what you have, what's missing and how complete you are. **Platforms** lists your consoles; open one for its page.

## Which consoles get a catalog

A console is **tracked** once you own a few different games for it (6 by default; Settings > Platforms > "Unique games to track a console"). Tracked consoles get a catalog and count for the wishlist.

## Where catalogs come from

Settings > Sources > Catalog sources lists the sources, most trusted first:

- **Your own list** of a console's games, a CSV with a Title column (and, if you like, release dates, regions and formats). On a console's page: **Use your own list**. It comes first; Wikipedia then only adds games released after it (a setting), and an older game it lists when you own a copy of it, so the copy counts (Settings > Catalogs and matching > **Games you own that your list lacks come in**).
- **Wikipedia's list of the console's games**, for your region (Settings > General > Home region).
- **Nintendo Life's** lists of Nintendo Switch 2 Game-Key Cards and full-card games: off unless you turn it on (its terms allow personal use).
- **IGDB (other regions)**: other regions' physical releases (PAL, Japanese, Asian) of a console that isn't region-locked (Settings > Platforms). They join its catalog on an **Other regions** tab and count once you own one; until then they're neither missing nor recommended. Needs IGDB.
- **Sources you add**: **Add a source**, under the list, takes an online list (a CSV file's address, a Google sheet shared with anyone who has the link, or a web page with a table of games) or a CSV file. First it shows what it found: games by console, regions and years. Then it joins the order at the bottom; move it up to trust it more. A list with a **Platform** (or Console) column covers several consoles; one without is for the console you choose. Its games count toward completion, or only once you own one, as other regions' releases do (**Details** changes that). An online list is read again whenever catalogs are refreshed (**Read it again** does it now); when it can't be read, its games stay as they were. Only add lists their owners let you use. Wikipedia's pages of [Super Rare Games](https://en.wikipedia.org/wiki/Super_Rare_Games) and [Limited Run Games](https://en.wikipedia.org/wiki/List_of_Limited_Run_Games_releases) releases work as online lists (free to reuse, CC BY-SA); with their games counting once owned, your copies of those limited prints find their games.

When sources disagree about a game's release date or format, the most trusted one wins, and the console's page shows the difference. Catalogs are rebuilt monthly, soon after a new console becomes tracked, and when you change the settings they're built from; **Rebuild now** on a console's page does it at once.

**Physical releases only.** Consoles whose Wikipedia lists mix in download-only games (the newer ones, and games Wikipedia marks as downloads) hold such games as **Not confirmed physical** until there's evidence of a physical release: your list (or a list you added), an IGDB listing of a physical release, owning it, or **It's physical** on the game.

## A console's page

- At the top: who made the console, its generation and its launch in your region (with Top 100 lists and console history on), how complete its catalog is as one bar in three parts (owned, missing, to review), and its counts as tiles that open their tab: owned, missing, needs review, excluded (games taken off its checklist), not confirmed physical, upcoming, not in catalog. Under them, how many games and copies you have for it, and their worth with its change over the last month or so of updates.
- Tabs for each of those, **Not in catalog** (games you own that match no catalog game: compilations, special releases, other names), and, with those parts on, **Top 100** and **History** ([Top 100 and history](top100-history.md)).
- **Download** gives the catalog as a spreadsheet.
- **Add game** adds a game the catalog doesn't have.

A game's drawer (click its title) answers the questions about it: **I bought it**, **It's physical**, **It's a target**. At its very bottom, **Exclude it** takes it off the console's checklist: it moves to the **Excluded** tab and no longer counts as missing, so a kiosk or a demo disc can't keep a console under 100%. Open an excluded game there and **Make it a target** brings it back. Both ask first and say what will happen.

## When a copy counts

Titles are compared after writing differences are taken out ("Pokemon" and "Pokémon", "&" and "and", a missing "The"). Editions count as the game ("Game [Greatest Hits]", "Game: Gold Edition"). Titles that only look alike are never counted on their own: they become questions on the **Review** page, where you answer **Same game** or **Different**. The full rules are in [How matching works](../MATCHING.md).

**Mappings** handle what titles can't: a compilation that counts as each of its games, or a game known by another name. A console's page takes a CSV of them (**Use your mappings**).

## Settings worth knowing

- **Settings > Catalogs and matching:** whether editions count, whether upcoming games count as missing, whether Nintendo Switch 2 Game-Key Cards count, download-only games, unlicensed games.
- **Settings > Platforms:** when a console is tracked, region-locked consoles, and console names to leave out (PC games, say).
