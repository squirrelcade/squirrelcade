# Squirrelcade API

Everything the web interface does goes through a JSON API under `/api/v1`, so other tools (scripts, n8n, a recommender) can use it too. This page covers the parts most useful from outside; the rest can be seen in the browser's network tab.

## Signing in

Send the API key (Settings > Security) in a header:

```
X-Api-Key: <your key>
```

`?apikey=<key>` in the URL also works, but URLs end up in proxy and browser logs; prefer the header. Behind Cloudflare Access, tools also need an Access service token (or run on the home network).

The API key acts as the collection's owner. People sign in with an account: the owner (one, who can hand the collection to someone else) or a viewer, who can look at the collection but change nothing. A viewer may make only the reads the collection's pages make (the list is in `apps/server/src/access.ts`); anything else answers `403 {"error": "owner-only"}`. Their answers leave out what the owner doesn't share with them (Settings > Security > Viewers): prices paid, notes, the PC library, what they played, their copies' details, and always RomM links. `GET /api/v1/auth/session` gives `role` (owner or viewer) and `publicCheck` (whether the sign-in page leads with checking a game).

```
GET    /api/v1/users                     the accounts ({users: [{id, username, role, createdAt, lastSeenAt, you}], invites: [the links not used yet]})
DELETE /api/v1/users/<id>                removes a viewer's account (never the owner's)
POST   /api/v1/users/<id>/owner          hands the collection to that account; the owner until now becomes a viewer
POST   /api/v1/invites                   {"name": "Mom"} makes a link to invite a viewer, {"userId": 3} one that lets that account choose a new password: {id, path: "/join/<token>", expiresAt}; the token is only in this answer
DELETE /api/v1/invites/<id>              withdraws a link
GET    /api/v1/join/<token>              (no sign-in) whom a link is for, while it works (Settings > Security > "Invite links work for")
POST   /api/v1/join/<token>              (no sign-in) {"username": "mom", "password": "..."} uses the link: a new viewer (or the account's new password), signed in
```

Another program (a start page, an assistant) can invite people with the API key: `POST /api/v1/invites` with `{"name": "..."}`, then send the person Squirrelcade's public address (Settings > General) followed by the answer's `path`. Each link works once, until it expires.

## Checking a game without signing in

When Settings > Security > "Check a game without signing in" is on, the sign-in page leads with it, and anyone who can reach Squirrelcade can ask:

```
GET /api/v1/check?barcode=<digits>
GET /api/v1/check?q=<title>
```

```json
{
  "currency": "USD",
  "productName": null,
  "searchedFor": "okami",
  "message": null,
  "results": [
    { "platformKey": "playstation-3", "platform": "PlayStation 3", "title": "Okami", "answer": "own", "ownedOn": [], "coverId": null, "valueCents": 1000, "wishlist": null, "links": [] }
  ]
}
```

`answer` is own (they have it), elsewhere (on another console, `ownedOn`), need, maybe (something like it is in the collection) or not-collected. A game they need has its wishlist priority and `links` to its prices (PriceCharting and the shop links for its console); `valueCents` is what their copy is worth, only when "Show what your copy is worth" is on. At most 5 games, and "Checks per 10 minutes" from one address (then 429). Nothing else about the collection: no notes, prices paid or other copies.

## Share links

A page anyone with its link can open without signing in: the wishlist's top picks, or the copies marked for sale or trade. The owner makes and removes them:

```
GET    /api/v1/shares                    the links: [{id, kind: "wishlist" | "sale", name, path: "/share/<token>", createdAt, lastOpenedAt, opens}]
POST   /api/v1/shares                    {"kind": "wishlist" | "sale", "name": "Mom"}: makes a link (201)
DELETE /api/v1/shares/<id>               removes it; it stops working at once
GET    /api/v1/share/<token>             (no sign-in) the page: {kind, name, instanceName, currency, generatedAt, wishes | sales}
```

`wishes` are the top picks (Wishlist > Scoring > Games on a shared wishlist), each `{rank, title, platform, coverId, priority, links}` with links to PriceCharting and the shop links for its console. `sales` are `{title, platform, condition, quantity, kind: "sale" | "trade", askingCents, note, coverId}`. Nothing else about the collection. An address can open share pages a limited number of times in 10 minutes (Settings > Security), then 429.

## Is this game owned?

```
GET /api/v1/lookup?q=<title>[&platform=<platform key>][&limit=<1 to 30>]
```

The answer Store Mode shows, for every catalog and collection game whose title matches, best matches first (at most 30, or `limit`):

```json
[
  {
    "platformKey": "playstation-3",
    "platform": "PlayStation 3",
    "title": "Tales of Graces f",
    "answer": "need",
    "ownedAs": [],
    "ownedOn": ["Nintendo Switch"],
    "maybe": [],
    "wishlist": { "score": 87, "priority": "High", "rank": 4 },
    "coverId": "co1abc",
    "note": "The one with the art book"
  }
]
```

`answer` is one of:

| answer | meaning |
| --- | --- |
| `own` | Owned on this platform (exact title, edition, reviewed mapping or confirmed link); `ownedAs` lists the copies. |
| `need` | In the platform's catalog and not owned. |
| `own-elsewhere` | Not owned on this platform, but owned on another (`ownedOn`). |
| `check` | Needs review: something owned looks like it (`maybe`). |
| `own-not-in-catalog` | Owned, but the platform's catalog doesn't list it. |
| `not-a-target` | Excluded from the collecting target. |
| `unconfirmed` | In the platform's catalog and not owned, but not known to have had a physical release (see Catalogs below), so not counted yet. A copy on the shelf settles it: `PATCH /api/v1/catalogs/entries/<entryId>` with `{"targetStatus": "required"}`. |

`note` is your own note on the game (null without one; see "One game" below).

`preference` is your wishlist preference for a catalog game (`"Must Have"` ... `"Do Not Recommend"`, or null), changed with `PUT /api/v1/wishlist/preferences`. The same field comes with a console's catalog games (`GET /api/v1/catalogs/<key>`), the ownership answers below (catalog games only), a set's games (with `catalogTitle`, the catalog's title it's kept under), a series' games and the timeline's landmark games you don't have.

Store Mode's search finds titles as you type them. A tool that already knows the game's title, such as a recommender, asks instead:

```
POST /api/v1/owned              {"games": [{"title": "Zelda Twilight Princess"}, {"title": "Okami", "platform": "playstation-3"}]}   (1 to 100 games)
GET  /api/v1/owned?title=<title>[&platform=<platform key>]                                                                      (one game)
```

```json
{
  "results": [
    {
      "title": "Okami",
      "platform": "playstation-3",
      "owned": false,
      "ownedOn": ["Wii"],
      "ownedOnPc": [],
      "answers": [{ "platformKey": "playstation-3", "platform": "PlayStation 3", "title": "Okami", "answer": "own-elsewhere" }]
    }
  ]
}
```

`owned` is true when a copy counts for the game on the console asked about (on any console when none is given), a copy just marked as bought included; `ownedOn` lists every console with a copy, `ownedOnPc` the PC storefronts where it's owned for good. Only the same title counts, compared as the catalogs compare titles (editions, "The", roman numerals, "Zelda Twilight Princess" for "The Legend of Zelda: Twilight Princess"), with each console's own answers as below: never a fuzzy guess. The GET form answers with one result.

This is the exact ownership check a recommender should use: the same title rules as the collection pages, never a fuzzy guess.

Answers also carry `ownedOnPc`, the PC storefronts where the same game is owned for good (related, never counted). Owned answers carry `ownedReleases`, which releases the owned copies are: `[{"region": "japan", "consoleLabel": "Super Famicom"}]` (the region, and PriceCharting's console name). Results for catalog games include `entryId`, and `pending: true` when the game is owned only through a "just bought" mark. Marks are managed with:

```
GET    /api/v1/purchases                 games marked as bought and not yet in an export
POST   /api/v1/purchases                 {"entryId": 123}
DELETE /api/v1/purchases/<id>
```

By barcode (UPC/EAN):

```
GET /api/v1/lookup/offline     Store Mode's copy for answering without a connection: every answer a search could give (short keys: "p" the platform's place in "platforms", "t" title, "a" answer, "on" other consoles, "pc" PC storefronts, "m" possible matches, "w" wishlist, "s" sets, "n" your note, "e" the catalog game's id for POST /api/v1/purchases), and "barcodes" you saved as [digits, platform's place, title]. Sent gzipped when the client takes it, with an ETag: If-None-Match gets 304 when nothing changed.
GET /api/v1/lookup/barcode/<digits>
GET /api/v1/barcodes/<digits>      Scan my shelf (owner): the game Squirrelcade has saved for a barcode, never asking a service: {saved: {code, platformKey, platform, title, source} | null} (400 when it isn't a barcode)
GET /api/v1/barcodes/coverage      Scan my shelf (owner): each console with copies, and how many of its games have their barcode: [{key, name, games, withBarcode}]
```

A barcode answer: `{code, known (linked before), productName (what the barcode service called it), searchedFor, platformKey, platformName, results, message, retryInSeconds, lookups}`. `retryInSeconds` is set while the barcode waits its turn with the barcode service (6 lookups a minute): it's looked up in the background, so ask again then. `lookups` is `{left, resetAt}`, the service's own count of lookups left today, when the answer asked it or waits for it. `GET /api/v1/check?barcode=` (the family check) passes `retryInSeconds` too.

Today's page in one answer (viewers may read it; `loans` is null for a viewer who isn't shown copies' details):

```
GET  /api/v1/today         {date, gotd, deals (up to 3, games you don't have), dealsOn, releases (the next 7 days), loans (overdue or due within 7 days), lastUpdate: {fileName, appliedAt, addedCount, removedCount, changedCount, ageDays}}
```

The game of the day (while it's on; viewers may read it):

```
GET  /api/v1/gotd          {game: {date, platformKey, platform, title, score, priority, rank, reasons: [{label, points}], why, released, anniversary, coverId, preference, links: [{name, url}]} | null}
POST /api/v1/gotd/another  passes today's game over and draws another: {game}
```

Deals from PriceCharting's emails (viewers may read them):

```
GET  /api/v1/deals         {on, days, deals: [{id, date, title, console, priceCents, saveCents, listingTitle, listingUrl, imageUrl, priceChartingUrl, platformKey, platform, gameTitle, status, wishlist, coverId}]}
```

`title` and `console` are PriceCharting's; `gameTitle` and `status` (owned, missing, review, unconfirmed, excluded) are the console catalog's game, when it has it. The game of the day's `game` carries `deal` when its game has one.

Stash updates from email (owner only):

```
GET  /api/v1/mail          {on, account: {user, host, port} | null, problem, lastCheck: {at, ok, message} | null, recent: [{date, subject, status, detail, importId}], exportUrl}
POST /api/v1/mail/test     signs in and looks, changing nothing: {ok, message}
POST /api/v1/mail/check    looks for new export emails now (the "mail-import" task): {queued}; 409 while the part is off
```

An email's `status` is `applied`, `pending` (held for you), `refused`, `duplicate`, `expired` (PriceCharting's link lasts 7 days), `no-export` or `failed`. Updates it makes show on `GET /api/v1/imports` with `"source": "email"`.

A barcode's answer: `{code, known, productName, searchedFor, platformKey, platformName, results, message}`. `code` is the barcode as Squirrelcade keeps it (a UPC read with zeros in front is its 12 digits). `known` is true for a barcode you linked (`POST /api/v1/barcodes` with `{code, platformKey, title}`). For a new one, `productName` is what the barcode service calls it, `searchedFor` the title found in that name (or the name cleaned of packaging words when none fits), and `platformKey` and `platformName` the console the name gives, whose games come first in `results`. The phone check (`GET /api/v1/check?barcode=<digits>`) also answers `lookupUrl`, PriceCharting's page for the barcode, and its PriceCharting link for the scanned game goes by the barcode.

## The wishlist

```
GET /api/v1/wishlist                     top picks with every point explained
GET /api/v1/wishlist/platforms/<key>     one platform's list
GET /api/v1/wishlist/export              top picks as CSV (?list=platforms for every platform's list), with your note on each game
GET /api/v1/wishlist/tastes              what the collection says: consoles by games added lately, genres by how much more of them you own than the catalogs hold, games owned per series, and the points lists learned from them
```

Scores run from 0 to 100 by default (Wishlist > Scoring). Each game's `components` add up to its score: platform, region, genre (IGDB's genres averaged), style, reviews ("Reviews: 91 on IGDB (76 ratings)"), a series you collect, completion and the rest; a game with more points than the top shows a "Capped at 100" line.

## The collection

```
GET /api/v1/collection/summary           totals and per-platform counts
GET /api/v1/collection/goal              {goal}: the collection against its goal (Settings > Collection > Your goal): {goal, counts ("copies" | "games"), now, yearAgo, change, perMonth, remaining (below 0: over it), reachBy (YYYY-MM-DD at the last 12 months' pace, or null)}; null without a goal
GET /api/v1/collection/items?platform=<key>&region=<region>&q=<text>&page=1&pageSize=100   each copy on its own (missing=1: only the ones waiting on Review)
GET  /api/v1/collection/missing          the copies whose file no longer has them, waiting on Review: [{id, key, title, platform, platformKey, condition, source, missingSince, valueCents, others}] (owner only)
POST /api/v1/collection/missing/<id>     {"answer": "keep" | "sold" | "removed"}: kept, it's a copy of Squirrelcade's own from then on (no file removes it); sold or removed, it leaves the collection
GET /api/v1/platforms                   every platform: games, copies, value, and its value at the previous update (valueBeforeCents, valueSince)
GET  /api/v1/sources/retroachievements          RetroAchievements (with it on): {on, configured, games, matched, beaten, mastered, syncedAt}
POST /api/v1/sources/retroachievements/test     whether RetroAchievements takes the username and key: {ok, message}
POST /api/v1/sources/retroachievements/sync     reads the progress again now (202; in the background)
GET  /api/v1/sources/xbox                        Xbox achievements (with them on): {on, configured, games, matched, completed, syncedAt}
POST /api/v1/sources/xbox/test                   whether OpenXBL takes the key, and whose it is: {ok, message}
POST /api/v1/sources/xbox/sync                   reads the achievements again now (202; in the background)
GET  /api/v1/sources/playstation                 PlayStation trophies (with them on): the same, and signedInUntil (when the sign-in runs out)
GET  /api/v1/system/ai-setup                     Help > AI-assisted setup (owner): the prompt's two parts only this install knows, in Markdown: {state, links} (?address= the page's own address, for the links; never a password, key or token)
GET  /api/v1/sources/steam                       Steam achievements (with them on): {on, configured, games (with achievements), completed, syncedAt}
POST /api/v1/sources/steam/test                  whether Steam takes the key, whose profile it is and how many games: {ok, message}
POST /api/v1/sources/steam/sync                  reads the achievements of the games played since the last read (202; in the background)
POST /api/v1/sources/playstation/test            whether PlayStation takes the sign-in token, and how many games have trophies: {ok, message}
POST /api/v1/sources/playstation/sync            reads the trophies again now (202; in the background)
GET /api/v1/collection/upgrades          owned games whose best copy isn't complete: {items: [{platformKey, platform, title, includeString, completeness (loose, item-box, item-manual), valueCents, missing (box, manual), status, rating, igdbRating, priceUrl}]}, your favorites first; a viewer not shown what you played gets no ratings or statuses
GET /api/v1/collection/history           games, copies, value and paid at each update, with its date (the export's date from PriceCharting's file name, or when it was applied), and each platform's totals in it (platforms: key, name, games, copies, valueCents, costCents; null for updates from before they were kept)
GET /api/v1/collection/export            the collection as a CSV: every copy with its console, region, condition, value, paid, dates, the catalog game it counts as, its series, what you played of it, where it's kept (tags, lent to, for sale), and your note on that game
GET /api/v1/collection/spending          what the copies cost by the month they were bought (or added), and the last 12 months by console
GET /api/v1/collection/statistics        the collection counted every way: totals, copies and value by console, condition and region, games by decade and genre (IGDB), copies added and money spent each year, the most valuable copies, and games by play status
GET /api/v1/collection/report            every copy by console with its condition, region, value (and paid, and where it's kept), and totals: the printable report's data
GET /api/v1/export/workbook              everything as an Excel workbook (.xlsx): a tab each for a summary, the collection, the wishlist, each console's missing games, what you played, loans, the games for sale, notes, the PC library and the Top 100 lists of the consoles you collect
```

`collection/items` and `collection/export` also filter by what's kept beside the collection: `play=` (a status, `backlog` or `unmarked`), `location=`, `tag=`, `lent=1` and `sale=` (`sale`, `trade` or `any`). Each item is one copy (0.19.0; `quantity` is always 1) with its `key` and `copyKey` (the same: what its details are kept under, which never changes), `source` (`pricecharting`, `spreadsheet` or `squirrelcade`: whose files keep it up to date), `missingSince` (when its file stopped having it, or null), `play` (`{status, rating}` or null) and `details` (`{location, tags, sale, lentTo, photos}`, or null when they aren't shown to the requester).

Each item has its `region` (`north-america`, `japan`, `europe`, `asia` or `other`) and `consoleLabel`, PriceCharting's console name ("Super Famicom", "PAL Playstation 3"); `region=` filters by it.

On region-locked consoles (Settings > Platforms), copies from another region than the home region belong to a platform of their own: `super-famicom`, `famicom`, `pc-engine`, `mega-drive-japan` and `mega-drive-pal` by name, the others as the console's key plus `-japan`, `-pal`, `-asia` or `-north-america` (`nintendo-64-japan`, "Nintendo 64 (Japan)"). Changing that setting or the home region moves copies between platforms.

## PC library

```
GET    /api/v1/pc                         the PC library's state: the Playnite folder, the newest backup, the last reading, a held reading, counts by storefront and ownership
GET    /api/v1/pc/games                   one row per game (?q=, storefront=, ownership=permanent|subscription|historical, installed=yes, achievements=completed|started (Steam achievements; each Steam record has achievements: {earned, total, progress, completed, lastPlayedAt} or null), view=both|pc-only, sort=title|playtime|played|storefronts, dir=, page=, pageSize=)
GET    /api/v1/pc/export                  the PC library as a CSV, with the same filters (q, storefront, ownership, installed, played, view)
GET    /api/v1/pc/reads                   the last readings
GET    /api/v1/pc/sealed                  console games kept sealed and not owned on PC
POST   /api/v1/pc/read                    read the newest Playnite backup now (in the background)
POST   /api/v1/pc/snapshot                multipart form with a "file" field: a snapshot the Playnite reader wrote (JSON, not the backup ZIP)
POST   /api/v1/pc/reads/<id>/apply        apply a held reading
POST   /api/v1/pc/reads/<id>/discard      discard a held reading
PUT    /api/v1/pc/audit                   multipart form with a "file" field: the ownership audit (CSV: Source, Storefront Game ID, Title, Ownership Status, Active)
DELETE /api/v1/pc/audit                   removes the audit from a file (answers on single games stay)
PATCH  /api/v1/pc/games/<record key>      {"ownership": "permanent" | "subscription" | "historical" | null}: how one storefront game counts
```

Each game (`items` in `/pc/games`) has its storefront `records` (each with `ownership` and whether the owner's audit decided it, `audited`), `owned` (owned for good somewhere), `playtimeHours`, `lastActivityAt`, `genres` and `consoles`, the physical console copies of the same game in the collection (`platform`, `copies`, `sealed`). Games are grouped by title without edition marks, so a related game with the same title can show up among the console copies.

## PC wishlist

```
GET    /api/v1/pc/wishlist                the PC wishlist: ranked games (each with its components, sources, Steam reviews, Steam app id, and with PC game prices on its "price"), counts of games found, owned on PC and hidden, and "pricesOn"
GET    /api/v1/pc/wishlist/hidden         games you hid or snoozed
GET    /api/v1/pc/wishlist/export         the list as CSV
POST   /api/v1/pc/wishlist/discover       search for PC games now (in the background)
PUT    /api/v1/pc/wishlist/<key>          {"action": "hide" | "defer" | null, "until": "YYYY-MM-DD", "preference": "Must Have" | null}: your choice on a game (by its key)
POST   /api/v1/pc/prices/refresh          read the prices from IsThereAnyDeal now (in the background; PC game prices on, or 404 "feature-off")
POST   /api/v1/pc/prices/test             checks the saved IsThereAnyDeal key with one lookup: {"ok": true | false, "message": "..."}
```

A game's `price` (PC game prices on, Settings > Features) is IsThereAnyDeal's: `{currentCents, regularCents, cut, shop, url, lowCents, currency, atLow, missing, fetchedAt}`, the best price now among the stores, its lowest ever, and whether it's at that; null before it's read, `missing` when IsThereAnyDeal doesn't have the game.

## Sets

```
GET    /api/v1/sets                      your sets, each with its completion and its consoles
POST   /api/v1/sets                      {"name": "...", "page": "List of ... (or its address)", "collectedOnly": true}: makes a set; with a Wikipedia page it's read right away, without one upload its list next
GET    /api/v1/sets/<key>                the set and its games: each with its console, status (owned, missing, review), the owned titles that count, and look-alikes (maybe)
PUT    /api/v1/sets/<key>/list           a CSV with Title and Platform columns (multipart): replaces the set's games
POST   /api/v1/sets/<key>/rebuild        reads a Wikipedia set's page again
PUT    /api/v1/sets/<key>/answers        {"platformKey", "title", "ownedTitle", "decision": "same" | "different" | null}: your answer about a set game and an owned look-alike
POST   /api/v1/sets/<key>/games          {"platformKey", "title", "action": "add" | "remove"}: a game added by hand, or taken out (kept when the list is read again)
POST   /api/v1/sets/<key>/restore        brings back the games of the list you took out
PATCH  /api/v1/sets/<key>                {"name": "...", "collectedOnly": false}
DELETE /api/v1/sets/<key>                removes the set (the collection and catalogs stay as they are)
GET    /api/v1/sets/<key>/export         the games as CSV; ?status=missing for what's missing
```

Store Mode's answers (`GET /api/v1/lookup`) carry `"sets"`: the names of the sets the game is in; a set's missing games that no console catalog has are answers of their own.

## Catalogs

```
GET    /api/v1/catalogs/upcoming         games not out yet on the consoles with a catalog, soonest first (release date, console, format, status, wishlist score)
GET    /api/v1/catalogs/past             past releases: for each of the last few years (Settings > Interface), [{yearsAgo, from, to, games: [{entryId, platformKey, platform, title, releaseDate, format, status, score, coverId}]}], the games released around today's date that year
GET    /api/v1/catalogs/upcoming.ics     the same as a calendar file (iCalendar) to import: each dated release an all-day event
GET    /api/v1/catalogs                  completion per platform
GET    /api/v1/catalogs/<key>            a platform's catalog (?status=missing|review|owned|excluded|unconfirmed|upcoming, ?sort=title|genre|released|score&dir=asc|desc); each game has its IGDB genres
GET    /api/v1/catalogs/<key>/export     the same as CSV
GET    /api/v1/catalogs/sources          where each console's catalog comes from (your list, Wikipedia pages) and its last build, with what each source gave it and where they disagreed
GET    /api/v1/catalogs/source-status    each catalog source's state: your lists, Nintendo Life's last reading, Wikipedia's builds, each source you added
POST   /api/v1/catalogs/build            rebuild now: {"platforms": ["nintendo-switch"]}, or {} for every tracked console
PUT    /api/v1/catalogs/<key>/list       multipart form with a "file" field: the console's own list (CSV); a build starts
DELETE /api/v1/catalogs/<key>/list       removes it; the next build uses Wikipedia alone
PUT    /api/v1/catalogs/<key>/mappings   multipart form with a "file" field: owned titles that count as catalog games (CSV: Owned Physical Title, Satisfies Canonical Title, optionally Mapping Type, Counts as Complete Yes/Conditional/No, Notes); replaces the last file's
DELETE /api/v1/catalogs/<key>/mappings   removes them
GET    /api/v1/catalog-sources           the catalog sources you added: [{id: "added-1", name, kind: link|file, url, fileName, platformKey, counts: complete|owned, games, consoles: [{key, games}], readAt, error}]
POST   /api/v1/catalog-sources/preview   what a list has, before it's added: {"url": "https://...", "platform"?: "nintendo-switch"} or a multipart form (platform, then file); {usable, name, games, consoles, regions, years, unknown, consoleColumn, columns, problems}
POST   /api/v1/catalog-sources           adds one (as the preview, plus name and counts): it joins the order at the bottom, switched on, and its consoles are rebuilt
PATCH  /api/v1/catalog-sources/<id>      {"name"?, "counts"?: "complete"|"owned"}
POST   /api/v1/catalog-sources/<id>/read reads an online list again; its consoles whose games changed are rebuilt
DELETE /api/v1/catalog-sources/<id>      removes it; its games leave the catalogs (those you answered about stay)
```

A platform's catalog gives `regions`, the games and copies owned there per release (`[{"region": "europe", "consoleLabel": "PAL Nintendo Switch", "games": 40, "copies": 43}, ...]`, the most copies first); each owned game's `matches` and each game in `notInCatalog` carry their own `region` and `consoleLabel`.

A console's catalog is its own list, when it has one, with Wikipedia's list of its games under it. A list needs a title column (Title, Canonical Title, Game or Name). Other columns are read when present: other names (Also known as), release date, region, status (Required, Current or Upcoming; Optional; Review; Excluded or Not required), format and notes.

On consoles whose Wikipedia list includes download-only games, a game counts only with evidence of a physical release: it's on your list, IGDB lists a physical release, you own it, or you confirmed it. The same goes, on any console, for games Wikipedia marks as download titles: a mark such as Xbox Live Arcade's, or (for the consoles Settings > Catalogs and matching names) an article in a download category such as "PlayStation Network games". Games without that evidence have the status `unconfirmed`, and don't count toward completion or the wishlist. `/catalogs/sources` gives each console's number of such download titles as `downloads`.

A catalog is built from its sources in the order Settings > Sources > Catalog sources gives (`sources.catalogOrder`, most trusted first): your list, Nintendo Life's Switch 2 lists (when on), Wikipedia. In `/catalogs/sources`, each console's `sources` says what each gave the last build (`listed`, `added`, `matched`, `filled`, `older`), and `conflicts` where they disagreed about a game's `releaseDate` or `format` (`kept` is the more trusted source's value, which stands; `other` the one it overruled). Each game's `source` is the source that brought it (`list`, `nintendo-life`, `wikipedia`). `sources.datesFrom` and `sources.formatsFrom` name a source to trust first for release dates and for formats (empty: the order decides).

Two settings can take games out of completion and the wishlist (Settings > Catalogs and matching; by default both count). With "Upcoming games count as missing" off, games not out yet (dated after today, or "TBA" in your list) have the status `upcoming` until their date passes; completion counts give their number as `upcoming`. With "Game-Key Cards count" off, games whose format (your list's Format column) is a Switch 2 Game-Key Card are `excluded`.

## Updating the collection

```
POST /api/v1/imports                     multipart form with a "file" field: a PriceCharting collection export (CSV, or the zip it arrives in), or a spreadsheet of your own saved as CSV
```

The response says whether the update was applied, held for confirmation (it would remove too much), refused (and why), or the same export was already used (`duplicate`). An applied update's report has `copies`: `{matched, added, missing, gone}`, what it did to the collection's copies (0.19.0): the copies its kind of file keeps that it no longer has wait on Review (`missing`), or leave with it (`gone`) when Settings > Collection > Safety says so. A zip is taken as it is: the CSV inside it is used. A file without PriceCharting's columns is read as a spreadsheet of your own: a Title and a Console column, and optionally Condition, Quantity, Value, Price paid, Date purchased, Region and Notes (other names for them are in docs/help/collection.md); its report's first warning says so.

## RomM links

When RomM is on (Settings > Features) and set up (Settings > Sources), owned games carry a `romm` field in the collection's items (`GET /api/v1/collection/items`), a console's owned catalog games (`GET /api/v1/catalogs/<key>`) and Store Mode's owned answers (`GET /api/v1/lookup`); `null` when RomM doesn't have the game:

```json
{ "romId": 102, "name": "Street Fighter II", "url": "https://roms.example.com/rom/102", "playUrl": "https://roms.example.com/rom/102/ejs", "possible": false }
```

`playUrl` is null when RomM can't run the ROM in the browser; `possible` is true for a match by title only.

```
GET  /api/v1/sources/romm              the index: when it was read, ROMs, platform mapping, owned games found
POST /api/v1/sources/romm/test         checks the address and token
POST /api/v1/sources/romm/sync         reads RomM again now (the "Update the RomM index" task)
```

## Top 100 lists and history

With Top 100 lists and history on (Settings > Features; off, these answer 404 with `"error": "feature-off"`):

```
GET /api/v1/history                          the consoles with a Top 100 list ("top100") and with a history ("history"), and the lists' version
GET /api/v1/history/top100/<key>             a console's Top 100 in rank order: each game's year, cover, developers and publishers, why it matters, and what the collection has of it (owned, review, maybe or missing; its copies with their condition; other consoles and PC storefronts; wishlist rank and preference; RomM link), with a summary ("owned", "inRomm"...)
GET /api/v1/history/consoles/<key>           a console's history: its profile (maker, generation, launches, units sold, hardware, how it did, firsts), Start here games with what the collection has of them, sources and status
GET /api/v1/history/timeline                 consoles by the year they came out, and landmark games by year
PUT /api/v1/history/games                    {"platformKey", "title", "text" (null: back to Squirrelcade's), "sources": [...], "status": "draft" | "verified"}: your version of why a game matters
PUT /api/v1/history/consoles/<key>           {"profile", "startHere", "sources", "status", "asOf"} or {"reset": true}: your version of a console's history
```

A text's `origin` is `squirrelcade` (as shipped) or `yours`; `newerShipped` says Squirrelcade's own text changed since you made yours. RomM links for games you don't own come only with Settings > Sources > RomM > "Link games you don't own".

## Copies

```
GET /api/v1/copies?view=sealed-playable|sealed-only|multiple|all&how=pc|copy|romm&q=&page=&pageSize=
    each game with every copy: "consoles" (per console and title: copies, sealed, each copy's completeness) and "pc" (storefronts and how each counts), "total", "sealed", and "playable" (the ways to play a sealed game without opening it), with each view's count
GET /api/v1/copies/search?q=<title>          games to put a copy with, by title
PUT /api/v1/copies/group                     {"copyKey": "console|<key>|<title>" or "pc|<family>", "groupKey": "<a game's key>" | "own" | null}: a copy is another game's, on its own, or back with its title
```

## One game

```
GET /api/v1/game/summary?platform=<key>&title=<title>   IGDB's summary of the game ({"summary": "..."} or null), asked of IGDB the first time and kept
GET /api/v1/game/notes     your notes on games, newest first: [{platformKey, platform, title, note, updatedAt}]
PUT /api/v1/game/note      {"platformKey": "snes", "title": "Some Game", "note": "The one with the map"} saves your note on a game (up to 2,000 characters) under the catalog's title when the catalog has the game (the answer's "title"); "note": null or "" removes it
GET /api/v1/game?platform=<key>&title=<title>   everything about one game on one console: its catalog status and release, your copies (value, its history at each update that changed it, price paid), other consoles and PC storefronts you have it on, your sets, its wishlist points (or why it's off the wishlist), IGDB details, RomM link, your note, "history" (why it matters and its Top 100 rank), "retroAchievements" (your progress there, with RetroAchievements on), and "achievements" (your progress on Xbox and PlayStation: [{source, title, earned, total, pointsEarned, pointsTotal, progress, platinum, completed, lastPlayedAt}], with those parts on)
```

## What you played

```
GET /api/v1/play?status=backlog|playing|beaten|completed|dropped|shelf|unmarked|rated&platform=<key>&q=<title>
    the owned games (one per catalog game) with each one's status, rating, days started and finished, cover and IGDB rating, and each status's count
GET /api/v1/play/next[?platform=<key>]      one game from the backlog, at random but leaning toward IGDB's best rated: {"game": ...} or {"game": null}
PUT /api/v1/play                           {"platformKey", "title", "status": "playing" | ... | null, "rating": 1 to 10 | null, "startedAt", "finishedAt"}: saved under the catalog's title; neither status nor rating forgets the game's play
```

A status given without days sets them: Playing the day started, Beaten or Completed the day finished, Not played yet (`backlog`) clears both. Games not marked count as the backlog while Settings > Collection > "Games you haven't marked count as not played" is on. Viewers see these unless Settings > Security > Viewers says otherwise (then 403 `not-shared`).

## Looking after copies

```
POST   /api/v1/copy/tests                   {"key", "kind": "test" | "rip", "result": "works" | "issues" | "broken", "note", "testedAt"}: a test of a copy, or a rip (a full read of its disc; "works" is read fully), now unless testedAt says otherwise; 201
DELETE /api/v1/copy/tests/<id>              takes a test back
GET    /api/v1/collection/improve?gap=paid|date|photos|tested|location&platform=<key>&page=1&pageSize=50
                                            {counts, checked, total, items}: what copies are missing, by what Settings > Collection > Improve your collection counts; each item with its gaps, slots, missingPhotos, lastTest, location and estimatedCents
GET    /api/v1/collection/copies/<id>/suggestion   {suggestion}: Squirrelcade's suggestion for a copy's estimated price ({cents, basis: "new" | "used", newCents, date}), worked out only when asked; null when suggestions are off or its console has no usual price
GET    /api/v1/collection/estimates         {cents, copies}: the owner's estimates of the prices they don't know, together
```

`GET /api/v1/copy` has the copy's `tests` (the newest first); a photo has its `slot` (the standard photo it is, or null), set by a "slot" field when it's uploaded (it takes that place) or by `PUT /api/v1/photos/<id>` `{"slot"}`. The collection's items have `details.tested` (the last test) and `estimatedCents` (the owner's estimate of a price they don't know, or null; not for a viewer who isn't shown prices paid); the game drawer's copies have `slots`, `tests` and `estimatedCents`; Statistics has `estimated`. `PUT /api/v1/collection/copies/<id>` takes `estimatedCents` (null to clear it). An estimate is only ever set by the owner: it's never a price paid, never in a download, never sent anywhere.

## Copies of your own

```
POST /api/v1/collection/copies              {"platformKey", "title", "completeness" (sealed, complete, item-box, item-manual, loose, box-only, manual-only, graded), "costCents", "datePurchased", "notes"}: adds a copy (201 {copy, overGoal}: how many over the collection's goal it is now, 0 at the goal, null under it or without one)
PUT  /api/v1/collection/copies/<id>         {"completeness", "costCents", "datePurchased", "notes"}: changes a copy (any copy); what's changed here isn't overwritten by an export
POST /api/v1/collection/copies/<id>/remove  {"reason": "sold" | "removed"}: takes a copy out of the collection
GET  /api/v1/purchases                      the copies added in Squirrelcade that no export has yet: [{id, key, entryId, title, platformKey, platform, condition, costCents, createdAt, sentAt}]
POST /api/v1/purchases                      {"entryId", "completeness"}: "I bought it": adds a copy of a catalog game, bought today, in Settings > Collection's condition for a game just bought unless given (201 {id, key, overGoal}, as for Add a copy); the same game sent again the same day answers the copy already added (200)
DELETE /api/v1/purchases/<id>               takes back a copy just added (one no export has had, with nothing kept on it): {removed}
GET  /api/v1/send/pricecharting             {toSend, waiting, toRemove, text}: the copies added here as lines for PriceCharting's importer (text, one per line), the ones pasted and waiting for an export, and the copies sold or removed here that PriceCharting still lists
POST /api/v1/send/pricecharting/sent        {"ids": [...]}: the copies pasted into PriceCharting's importer
POST /api/v1/send/pricecharting/removed     {"ids": [...]}: the copies removed on PriceCharting by hand
```

Owner only. An export matches a copy added here by console, title and condition (any condition once it was sent: PriceCharting's importer reads only CIB and Sealed), and takes it over with its product and value; the fields the owner set in Squirrelcade stay.

## Selling

```
GET    /api/v1/collection/copies/<id>/listing?marketplace=ebay|mercari
                                            {copy, listing, price, photos, links}: a copy's listing (title, description, specifics, condition), its price (valueCents, askingCents, and at atCents the marketplace's feesCents, the shippingCostCents and netCents), its photos (taken, and the standard ones missing), and links (sold listings, the marketplace's form, PriceCharting)
GET    /api/v1/collection/copies/<id>/photos.zip   the copy's photos, the standard ones first, named by their place (404 without any)
POST   /api/v1/collection/copies/<id>/sell  {"soldCents", "marketplace": "ebay" | "mercari" | "local" | "other", "soldAt" (YYYY-MM-DD, today unless given), "feesCents", "shippingCostCents", "shippingChargedCents", "note"}: records a sale (the fees worked out and Settings > Collection > Selling's shipping unless given; none for a sale in person) and takes the copy out as sold; 201: the sale, with its netCents and gainCents (over what the copy cost, or null)
GET    /api/v1/sales                        {sales, month, year, all, mealCents}: every sale, the newest first, with each total's sales, soldCents, feesCents, shippingCostCents, netCents, paidCents, gainCents and meals
GET    /api/v1/sales/suggestions            {finished, twice, rising}: copies worth selling next (games finished; extra copies of games owned twice; the biggest rises in value since about a year ago, each with riseCents, risePercent and since), each with its value and why
GET    /api/v1/sales/export                 every sale as CSV
PUT    /api/v1/sales/<id>                   {"soldCents", "feesCents", "shippingCostCents", "shippingChargedCents", "soldAt", "marketplace", "note"}: changes a sale
DELETE /api/v1/sales/<id>                   takes a sale back (the copy returns to the collection): {undone}
```

Owner only. Nothing is posted to eBay or Mercari: the listing is text to copy into the marketplace's form.

## Your copies' details

```
GET    /api/v1/copy?key=<copyKey>          a copy's details ({location, tags, sale, askingCents, saleNote, digitalClaim, digitalClaimedAt, digitalStore}), its loans and its photos
PUT    /api/v1/copy                       {"key", "location", "tags": [...], "sale": "sale" | "trade" | null, "askingCents", "saleNote", "digitalClaim": "claimed" | "unclaimed" | "not-eligible" | null, "digitalClaimedAt": "YYYY-MM-DD", "digitalStore"}: the fields given change; with none left, the copy has no details kept
GET    /api/v1/tags                       the tags and places in use, with how many copies have each
GET    /api/v1/loans                      {"open": [...], "returned": [...]}: each {id, copyKey, title, platform, lentTo, lentAt, dueAt, returnedAt, note, overdue}
POST   /api/v1/loans                      {"key", "lentTo", "lentAt", "dueAt", "note"}: lends a copy (due after Settings > Collection > Lend for, unless dueAt says otherwise; null for no day)
POST   /api/v1/loans/<id>/return          {"day": "YYYY-MM-DD"} (today when left out): it's back
PUT    /api/v1/loans/<id>                 {"dueAt", "note", "lentTo", "returnedAt"}: changes a loan (a new due day can be reminded about again)
DELETE /api/v1/loans/<id>                 removes a loan from the history
POST   /api/v1/photos                     multipart form: "key", "caption" and "file" (JPEG, PNG or WebP, at most 4 MB): a photo of a copy (201)
GET    /api/v1/photos/<id>                the photo (the browser may keep it: a photo never changes)
PUT    /api/v1/photos/<id>                {"caption": "..."}
DELETE /api/v1/photos/<id>                removes a photo
GET    /api/v1/sale                       the copies for sale or trade (each with its id, for its listing), and the games owned more than once ("duplicates") with each copy's condition and whether it's marked
GET    /api/v1/sale/export                the copies for sale or trade as CSV
```

A copy is one copy you own (`copyKey`, as the Stash page's items and the game's drawer give it; before 0.19.0 it was a product in one condition, and those keys stay with the first copy of each). Viewers see these only with Settings > Security > "Viewers see your copies' details" (otherwise 403); they never change them.

A claimed digital license (Xbox's disc-to-digital, a code in the box) outlives its disc: the copy can be sold and the game still counts as owned for AI apps (`GET /api/v1/collection/items?digital=claimed` lists the copies with one).

## Claude and AI apps (MCP)

With Settings > Claude and AI apps on, Squirrelcade is an MCP server for Claude and other AI apps: Streamable HTTP at `<your address>/mcp` (stateless, plain JSON answers), read-only ([Claude and AI apps](help/ai-apps.md) has the steps). Two ways in: a key made on that page (`Authorization: Bearer sqk_...`; it answers as the account that made it, from the home network only unless the settings say otherwise), or, with "Let Claude's apps sign in from the internet" on, OAuth 2.1 as the MCP authorization spec describes. The API key doesn't work there.

```
POST   /mcp                                         MCP (JSON-RPC) with "Authorization: Bearer <access token>"; without one: 401 and WWW-Authenticate: Bearer resource_metadata="<address>/.well-known/oauth-protected-resource/mcp", scope="collection:read"
GET    /.well-known/oauth-protected-resource[/mcp]  the resource's metadata (RFC 9728): resource, authorization_servers, scopes_supported
GET    /.well-known/oauth-authorization-server      the sign-in's metadata (RFC 8414): PKCE S256, client ID metadata documents, dynamic registration, iss in the redirect
GET    /oauth/authorize                             the sign-in page (response_type=code, client_id, redirect_uri, code_challenge, code_challenge_method=S256, state, scope, resource)
POST   /oauth/token                                 form: authorization_code (code, code_verifier, redirect_uri, client_id) or refresh_token (rotated: a second use ends the connection)
POST   /oauth/register                              JSON: dynamic client registration, for the callbacks Settings > Claude and AI apps > Apps that may connect allows
POST   /oauth/revoke                                form: token (RFC 7009)
GET    /api/v1/ai/keys                              the owner's: {keys: [{id, name, username, createdAt, lastUsedAt, calls}]} (never the keys)
POST   /api/v1/ai/keys                              {"name": "Claude Code on the PC"}: a new key, {id, name, key, createdAt}; the key is only in this answer (201)
DELETE /api/v1/ai/keys/<id>                         revokes a key
POST   /api/v1/ai/plugin                            {"address": "http://192.168.1.20:7575", "name"}: a new key, written into the plugin for Claude Code and Cowork, as a zip (.claude-plugin/plugin.json, .mcp.json, server/relay.mjs, a skill, README.md); 409 while the connector is off
GET    /api/v1/ai/connections                       the owner's: {connections: [{id, who, guest, app, host, createdAt, lastUsedAt, calls}], address, on, signIn}
DELETE /api/v1/ai/connections/<id>                  ends a connection
GET    /api/v1/ai/guests                            {guests: [{id, name, email, createdAt, connections}]}
POST   /api/v1/ai/guests                            {"name", "email"} (201; 409 when the email is listed already)
DELETE /api/v1/ai/guests/<id>                       takes a guest off the list; their connections end
GET    /api/v1/ai/calls                             the newest 100 calls: {at, who, client, tool, asked, results, ms, outcome, grantId, keyId}
```

The tools: `check_ownership` ({titles: [up to 50], platforms?}), `search_games` ({query?, platform?, format?, storefront?, condition?, limit?, cursor?}), `get_game` ({id}), `get_wishlist` ({query?, platform?, priority?, limit?, cursor?}: the wishlist with each game's acorns, priority, rank and why; query finds one game's) and `list_platforms` ({}), each with an input and an output schema in JSON Schema 2020-12 (MCP's default dialect, so no `$schema`), answering with structuredContent (and the same JSON as text).

## Friends

```
GET    /api/v1/friends                      {friends: [{id, name, email, createdAt, lastSentAt, file}]}: file is null, or their last file in short ({from, madeAt, receivedAt, games, copies, wishes, forTrade, currency}) while it's fresh (Settings > Friends > Keep a friend's file for)
POST   /api/v1/friends                      {"name", "email"}: adds a friend, with a new code for your files with them (201)
PUT    /api/v1/friends/<id>                 {"name", "email"}
DELETE /api/v1/friends/<id>                 removes a friend and their file: {removed}
GET    /api/v1/friends/<id>/file            your file for them, as a download (what Settings > Friends > What you share shares)
POST   /api/v1/friends/preview              a friend's file (multipart "file", a .json or a zip with one, or {"text"}): {from, madeAt, currency, games, wishes, forTrade, friend} before it's brought in; friend is the friend whose files carry its code, or null
POST   /api/v1/friends/<id>/file[?force=1]  brings their file in (as above; 201: {friend, games, wishes, forTrade}); 409 when it carries another code than your files with them, unless forced (the smaller code is kept)
POST   /api/v1/friends/from-file            brings a file in, making the friend from it ("name" and "email" fields, or its from), or finding them by its code
GET    /api/v1/friends/<id>/compare[?platform=<key>]
                                            {friend, madeAt, currency, consoles: [{key, name, both, onlyYou, onlyThem}], platformKey, rows}: one console's games (the largest unless asked), each {key, title, theirTitle, mine, theirs, theirsForTrade, youWant, theyWant}
GET    /api/v1/friends/<id>/trades          {theyHaveYouWant, youHaveTheyWant, theirForTrade, yourForTrade, ideas: [{get, give: {items, totalCents, diffPct}}], margin, currency, sameCurrency}
GET    /api/v1/friends/<id>/games[?platform=<key>]
                                            {games: [{key, platformKey, platform, title, condition, valueCents}]}: every copy in their file, to pick one for trade-for
GET    /api/v1/friends/<id>/trade-for?item=<key>
                                            {target, margin, currency, offers: [{items, totalCents, diffPct}]}: what of yours evens out one of their games (a key from games, or from trades' lists)
```

Owner only; 409 for comparing or trading before their file is in. A file is JSON, `"format": "squirrelcade-friend"`, version 1: {from, code, madeAt, currency, collection: [{platformKey, platform, productId, title, copies: [{condition, valueCents}]}], wishlist: [{platformKey, platform, title, rank, acorns, priority}], forTrade: [{platformKey, platform, productId, title, condition, valueCents, kind: "sale" | "trade" | "spare", askingCents}]}. What you paid, notes, places, loans, photos and play are never in it.

## Series

```
GET /api/v1/series                       the IGDB series you own a game of: owned, missing and total catalog games, and their consoles
GET /api/v1/series/games?name=<series>   a series' catalog games with each one's status, the ones you don't own first
```

## Stats for dashboards

```
GET /api/v1/stats                        the collection's totals, flat, for start pages and dashboards
```

For widgets such as Homepage's `customapi`, which map top-level fields. Numbers are numbers, amounts are in the currency of Settings > General (`currency`), and before the first collection update everything is 0 or null. The answer is kept for a minute and is fresh after each collection update.

```json
{
  "games": 1250,
  "items": 1400,
  "platforms": 12,
  "trackedPlatforms": 9,
  "value": 31250.5,
  "cost": 18400,
  "gain": 12850.5,
  "currency": "USD",
  "addedLastUpdate": 12,
  "lastUpdateAt": "2026-09-27T20:13:53.651Z",
  "pricesAsOf": "2026-09-27",
  "valueChange": 412.25,
  "topPlatform": "Nintendo Switch",
  "topPlatformGames": 310,
  "spentThisMonth": 84.5,
  "spentLast12Months": 1920,
  "pcGames": 820,
  "pcOwned": 790,
  "pcHours": 1432.5,
  "backlog": 610,
  "lent": 2,
  "forSale": 14
}
```

| Field | Meaning |
| --- | --- |
| `games` | Different games (products) in the collection |
| `items` | Copies, counting quantities |
| `platforms` | Platforms with at least one game; `trackedPlatforms` have enough different games to be tracked |
| `value`, `cost`, `gain` | What the collection is worth, what was paid, and the difference |
| `addedLastUpdate`, `lastUpdateAt` | Games the last collection update added, and when it was applied |
| `pricesAsOf`, `valueChange` | The date the values are from (the export's, from PriceCharting's file name), and how much the value moved since the previous update (copies added or removed, and prices) |
| `topPlatform`, `topPlatformGames` | The platform with the most different games, and how many |
| `spentThisMonth`, `spentLast12Months` | What the copies bought this month, and in the last 12 months, cost (by purchase date, or the day added) |
| `pcGames`, `pcOwned`, `pcHours` | The PC library (read from Playnite): games across storefronts, those owned for good (not only through a subscription), and hours played; 0 without a PC library |
| `backlog`, `lent`, `forSale` | Games not played yet (as Stash > Backlog counts them), games lent out now, and copies marked for sale or trade |

PriceCharting's PC games are left out of the collection's totals, as everywhere in Squirrelcade (Settings > Platforms); the PC library has its own fields. For example:

```
curl -H "X-Api-Key: <your key>" http://<server>:7575/api/v1/stats
```

## Notifications

```
POST /api/v1/notifications/test              sends a test message through every way to send that's on and filled in: {results: [{channel, ok, error}]}; 400 "no-channels" with none
POST /api/v1/notifications/telegram/chats    the chats the saved Telegram bot has had a message from lately (for its chat ID): {chats: [{id, name, type}], message}
```

`channel` is email, pushover, pushbullet, ntfy, gotify, discord, telegram, slack, webhook or apprise. What Squirrelcade's own webhook sends (for n8n and the like) is in [Notifications](help/notifications.md#webhook-for-n8n-and-friends).

## Health

```
GET /api/v1/health                       no sign-in needed; {"status": "ok", "version": "..."}
GET /api/v1/system/status                version, uptime, database size, folders and the problems the health check sees
POST /api/v1/system/client-error         the interface reports a page that failed to draw ({"message", "stack", "path"}); it goes into the log, at most 20 in 10 minutes
GET /api/v1/system/support               a support file to download: the status, the settings (never passwords or keys), the tasks and their recent runs, recent log lines
```

`folders` lists the config, backups and watched folders, and Playnite's backup folder once the PC library uses it; each has `exists`, `writable` (usable for what Squirrelcade does there: written to, or only read when `needsWrite` is false) and `freeBytes`. `health` is a list of `{ "level": "warning" | "error", "message": "..." }`, the same problems the "Check health" task alerts about once each: a missing or unusable folder, old or missing backups, a staged restore, and for the PC library a backup folder that went empty or a newest Playnite backup older than Settings > PC library allows.

## Backups

```
GET    /api/v1/backups                   the backup folder, the second backup folder (copyFolder, or null), whether a restore is staged, and the backups
POST   /api/v1/backups                   makes a backup now (copied to the second backup folder too; copyError says why that failed)
GET    /api/v1/backups/<name>            downloads one
POST   /api/v1/backups/<name>/restore    stages it; it replaces the database when Squirrelcade restarts
DELETE /api/v1/backups/restore           cancels a staged restore
DELETE /api/v1/backups/<name>            deletes one
```
