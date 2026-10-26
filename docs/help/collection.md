# Your collection

Squirrelcade keeps your collection: every copy you own is a record of its own, with what only you know about it (where it is, tags, loans, photos). Type your games in (**Add a game**, below), or keep them up to date from an export: PriceCharting's brings each copy's value and its history, and a spreadsheet of your own or another collection app's export works too. Both together work as well.

The Stash's mark is a little treasure chest. Wherever Squirrelcade says you have a game ("Have it", "You own it", "Owned"), the chest is beside it, as the acorn is beside what you want.

## Updating it

1. On PriceCharting, **My Collection > Download (CSV)**. Keep the file's name (`collection_YYYYMMDD.csv`): its date is the date of the prices.
2. In Squirrelcade, open **Acorns > Stash updates** (or click **Update** on the Stash page) and drop the file on the box, or click the box to choose it. The `collection.zip` PriceCharting sends works as it is.

Other ways in: let Squirrelcade pick it up from your email (below), or save the file into the watched folder (the `imports` folder of a Docker install). Squirrelcade checks that folder every 15 minutes (Settings > Tasks), and **Settings > Collection** has its switch and its file name pattern.

Squirrelcade matches the export's copies to the ones it keeps (the same game in the same condition), adds the new ones, and shows what was added and removed. An export that would remove an unusual share of your games (10% by default) is **held** until you confirm it on Stash updates, in case the export was cut short.

A copy the new export no longer has isn't removed: it waits on **Review > Copies**, still counted, until you say what happened. **I still have it** keeps it as a copy of your own that no export removes (add it back on PriceCharting if you want its value there); **Sold** or **Gone** takes it out of your collection. The Review menu counts them, and the Stash page and the game's drawer mark them. To have such copies leave with the update instead (as before 0.19.0): Settings > Collection > Safety > **A copy the next update no longer has**.

## Adding a game by hand

**Add a game** (in the menu under **Acorns**, and a button on the Stash page) adds a game you have, typed in:

1. **Console:** pick it. Your consoles come first; every console Squirrelcade knows is there.
2. **Title:** start typing. Squirrelcade suggests titles from the console's catalog (with IGDB's too, when its keys are set up) and from your own games ("You have 1"). Pick a suggestion to match the game the catalog knows, or keep your own title: it's added as you typed it.
3. **Add it.** The copy is in your collection, and its **walk-through** opens at once (Settings > Collection > Adding copies): first a few questions (**Condition**, **Price paid** and **Bought on** unless you choose others), then a step for each of its standard photos (the box's front and back, the game itself...), with **Take** and **Skip**, and **Save and close** at the end. **Open the whole form** shows everything instead, and **Undo: I didn't buy it** takes the copy back. Turn the walk-through off there, and its whole window opens instead.

The form stays on the console for the next game, and **Added just now** lists what you added, each opening its page. Its value stays empty until a PriceCharting export has the game (see **Sending to PriceCharting** below). A console gets its catalog a few minutes after it has 6 different games (Settings > Platforms), and then suggests every one of its games. Until then, it suggests only the games you've added to it, and the page says so. Typing a collection in? Set that number to 1, and each console gets its catalog after its first game.

## A game's page

Click any game's title or cover to open its page (the game drawer). Every game looks the same wherever it's shown large (here, Game of the Day, Store Mode):

- **At the top:** its cover (with the consoles you have it on in its corner); its **consoles' marks**, one for each console it came out on, in color where you have it, faded grey where you don't, the one you're on outlined, PC at the end (tap one to open it there); its place on your wishlist and its priority; **Play on RomM** when your [RomM](romm.md) has the game (Open in RomM when RomM can't play it in the browser).
- **Its name with its stars:** its place in its console's Top 100 ("★ #2 Top 100"), its place on Wikipedia's best-selling list for its console, its headline awards (from Wikidata, with [Roots](roots.md) on), **Critics' favorite** (reviews of 90 or more: **Critics' favorite from**, Settings › Interface › Game pages), **Launch title** (out the day its console launched). Three show (**Stars beside a game's name**, same place); the rest are under "+n". Each says where it comes from when you point at it, and the Top 100 and best-selling stars open their lists.
- **Two circles**, as Game of the Day draws them: **Worth** for a game you have (what your copies are worth together, the ring filled by how much of your collection is worth less), or **Acorns** for a game you don't; and **Reviews**: Metacritic's score when the game's Wikipedia article gives it for that console (with Roots on), IGDB's rating otherwise (it says which).

Then **Your copy** comes first, whatever else is on: each copy with its condition, what you paid, what it's worth, where it's kept, its photos (tap one for full size), its tests and tags, and its own **Edit this copy**. Click **Worth** (or the small line beside it) to see what that copy has been worth at each collection update, with what you paid as a dashed line; **Show as a table** lists the values.

**A game on several consoles** has a row of every console it came out on, in release order: the ones you have lit with how many copies, the others dashed (tap one to open that console's page and get it), and **PC apart at the end**, after a line, since owning it on PC never counts as owning it on a console. Your copies on the console you opened it from are shown in full, with **Add a copy** beside **Edit this copy**; another console's copies are a tap on its chip above.

**A game you don't have** shows **Get it** in Your copy's place: your shops (the used marketplaces first; the rest under "more shops"), PriceCharting for what it sells for (Squirrelcade knows prices only for games you have), why it has its acorns, **I bought it**, **Add a copy**, **Snooze**, **Not a target** and your preference, and the consoles you have it on.

Below them: IGDB's summary, its Roots (its Top 100 place and why it matters), what you played, the sets it's in, your note, and links (its console's page, IGDB, PriceCharting, your shops).

## Consoles' marks

Every console has its own small mark, drawn after the console itself (its pad, its shape, its symbol: the Switch's two Joy-Con with the Switch 2's 2 beside them, PlayStation's symbol with its number, the N64's pad...), wherever a console is named: the search, Store Mode, a game's page, Roots, Nutshell > Platforms and a console's page, Series, the Stash's console filter. A mark is in its console's **color** where you have the game (or the console's games) and **faded grey** where you don't; PC's screen is lit when you have it on PC. A console without a drawing yet has a small pixel mark of its short name.

**On covers:** a small banner in the top right corner of a game's cover shows the consoles you have it on: the two newest, one per company (a game you have on the PS5, an Xbox and the Switch 2 shows the Switch 2 and the PS5), two of one company only when that's all you have it on, and PC at the right end. Settings > Interface > Appearance: **Console marks on covers** (on) and **A cover's PC mark when you don't have it on PC** (a faded PC mark, or none).

## Adding a copy in Squirrelcade

A game's drawer has **Add a copy**: **Add it**, and the copy's walk-through asks the rest, as on Add a game. **I bought it** in the drawer, and **Add it** in Store Mode, add one in one tap, bought today, in the condition Settings > Collection > Adding copies gives a game just bought (Store Mode's then opens the copy's window, for what you paid, notes and photos). The copy counts at once; its value comes with the export that has it (or from another copy of the same game in that condition, if you have one from PriceCharting). Under **Your copies**, a copy added here says **Added in Squirrelcade: not on PriceCharting yet**, with **send it** and, while nothing is kept on it, **take back**.

**Edit this copy**, in each copy at the top of a game's page, opens that copy's window (with where it is, lending and photos): its condition, what you paid, the day you bought it and notes, for any copy, one from PriceCharting's export too. What you change here stays yours: no export overwrites it, and the export still finds the copy. **Sold** or **Remove** takes it out of your collection (it stays in the history).

## Sending to PriceCharting

PriceCharting keeps the prices, so a copy added in Squirrelcade gets its value once it's on PriceCharting too. **Stash updates > Send to PriceCharting** sends the copies added here two ways:

**With their details (a CSV),** for the games PriceCharting knows: any game an export of yours ever brought (another copy of it, or one you've sold), or one you gave its PriceCharting ID. They go with everything PriceCharting's CSV importer takes: the condition, what you paid, the day you bought it, your notes (up to 300 characters), and, if you filled them in, who graded a graded copy and its certificate number (in the copy's window, when its condition is Graded) and a folder on PriceCharting for all of them (the card's **Folder on PriceCharting** box; PriceCharting makes the folder if it doesn't exist).

1. Check the list on the card (each game with its condition, what you paid, the day bought and your notes).
2. Click **Download the CSV**, then **Open PriceCharting's CSV importer** and upload the file there. Upload it once: PriceCharting adds every row as a new copy.
3. Back in Squirrelcade, click **I've uploaded it**.

**By title (the paste list),** for the games PriceCharting doesn't know yet: lines for its paste importer ("Okami Playstation 2 CIB"). It reads CIB and Sealed, not what you paid (that stays here); a copy in another condition comes in as loose, so set its condition there after pasting (the card says which). Click **Copy the list**, **Open PriceCharting's importer**, paste and add them, then **I've added them there**.

To send one with its details instead, give it its **PriceCharting ID** on the card:

1. Tap **Find it on PriceCharting**. When Squirrelcade knows the game's barcode (one you scanned and linked to it, or one another app's export brought), it opens the game's own page there; otherwise PriceCharting's search by title, where you open the game.
2. Copy the number under Item Details, **PriceCharting ID** (the label, or all of Item Details, can come along).
3. Come back and tap **Paste** beside the box: Squirrelcade takes the ID out of what you copied and saves it, and the copy moves to the CSV. On an iPhone, Safari shows its own **Paste** button first; tap it.

**Paste** is there when the browser lets a page read what you copied (Squirrelcade on an https address, or on the computer it runs on). Otherwise paste into the box (it keeps just the number) or type it, then **Save**. The next copy still waiting for its ID then comes up, marked **Next**, so a run through the list is: Find it, copy, back, Paste. Squirrelcade never looks anything up on PriceCharting itself: these are links your browser opens.

Then export from PriceCharting as usual, and bring the export in. It brings each copy's value to the same copy here (not a second one); what you paid, the day and your notes stay Squirrelcade's. A free PriceCharting account takes one import and one export a week.

A copy you sold or removed here that PriceCharting still lists is on the same card (**Sold or removed here, still on PriceCharting**) until you remove it there: the next export doesn't bring it back, and once an export no longer has it, it's off the list.

## From your email

PriceCharting emails you a link to your export when you ask for one. Squirrelcade can watch your mailbox for that email and update your collection from it, so an update is one tap on PriceCharting:

1. **Settings > Email:** fill in your email account once: your address, and an **app password** (a separate password your email provider makes for one app; for Gmail, make one at Google's app passwords page). The provider's steps are under **Set it up, step by step**.
2. Turn on **Stash updates from your email**, and click **Test sending and reading**: it signs in and says what it found. (PriceCharting's emails go to another mailbox? Its address and password go under **Show advanced > A different mailbox for exports**.)
3. On PriceCharting, **My Collection > Download (CSV)** as usual. Within half an hour (Settings > Email), Squirrelcade finds the email, downloads the export from its link, and updates your collection, with the same safety check as an upload.

**Stash updates** shows the last look at the mailbox, with **Check now** and **Export on PriceCharting**.

What it does with your mailbox:

- It signs in with the app password and looks only for emails from PriceCharting's address (`vgpc.com`) with "Exported Collection: Video Games" in the subject, from the last 7 days. It never marks, moves or deletes anything, and uses each email once.
- It downloads an export only from PriceCharting's storage (Google's), so an email pretending to be PriceCharting's can't send it elsewhere.
- Gmail finds the email even when a filter keeps it out of your inbox (Squirrelcade looks in All Mail).
- Outlook.com and Microsoft 365 mailboxes can't be read with a password; a forwarding rule to another mailbox works.

With a wishlist on PriceCharting, its **deal emails** (a game listed on eBay below the market value) are read the same way and listed on **Acorns > Deals**: see [the wishlist](wishlist.md#deals).

Squirrelcade can't ask PriceCharting for the export itself: that would mean signing in to PriceCharting as you, which isn't allowed. **Settings > Collection > Reminders > Remind me to export after** (7 days, say) sends a message with PriceCharting's page when your newest export gets old, so the tap is easy to remember.

## A spreadsheet of your own instead

No PriceCharting account? Keep your collection in a spreadsheet and upload it the same way, saved as CSV (in Excel: File > Save As > CSV; in Google Sheets: File > Download > CSV). Each row is a game you own; it needs a **Title** and a **Console** column, and can have more:

| Column | Also read as | What goes in it |
| --- | --- | --- |
| Title | Name, Game, Product name | The game's title. |
| Console | Platform, System | The console: PriceCharting's name ("PlayStation 2", "Super Famicom") or another common one ("SNES", "Super Nintendo (SNES)", "Microsoft Xbox", "PS4"). A region tag after it ("Nintendo 64 [EU]", "(PAL)") counts as the region. |
| Condition | Completeness, Includes, Ownership | Loose, CIB (complete), New or Sealed, Graded, Game and box, Game and manual, Box only, Manual only. |
| Quantity | Qty, Copies | How many copies (1 when empty). |
| Value | Current value, Your price, Price | What it's worth: `12.34`, `$12.34` or `12,34 €`. |
| Price paid | Paid, Cost | What you paid. |
| Date purchased | Purchase date, Date added, Created at | `2026-09-28`, `9/28/2026` or `28.09.2026`; a file that writes the day first (`25/04/2022`) is read that way. |
| Region | Country | Japan, PAL (Europe, Australia, or a European country) or Asia; empty (or USA) for North America. |
| Notes | Comments | Anything. |
| Barcode | UPC, EAN | The game's barcode: Store Mode then knows the game when it's scanned, with no barcode service. |
| Collection status | Status, User record type | Rows on a wish list, sold or on order are left out. |
| Category | | Rows that aren't games (systems, accessories) are left out. |

Commas, semicolons or tabs between the columns all work.

## From another collection app

Exports from these apps go in as they come, on **Stash updates** like a PriceCharting export:

- **CLZ Games:** export to CSV (Title and Platform, with Collection Status, Region, Completeness, Purchase Date, Purchase Price and Barcode if you pick them). Only games **In Collection** or **For Sale** come in, and their barcodes are saved.
- **GAMEYE:** export the collection spreadsheet. Only **Games** marked **Owned** come in, with their Ownership (CIB, Loose...), your price, what you paid and when you added them.
- **VGCollect:** the backup CSV (Settings > Export). Its Cart, Box and Manual marks become the condition, its price is what you paid, and a region tag after the console ("[EU]") the region; hardware and accessories are left out. (Read from VGCollect's documented layout; tell us if your file reads wrong.)

The report after the upload says how many rows were left out and why.

The upload's report says what it couldn't read (a condition it doesn't know, an amount that isn't one...). Each upload is your whole list: its games that PriceCharting's export already brought aren't doubled, the others are added, and a game your previous spreadsheet had and this one doesn't waits on Review (with the same safety check). A later PriceCharting export takes over the spreadsheet's copy of the same game, with its value. For the watched folder, name the file like PriceCharting's (`collection_YYYYMMDD.csv`) or add your own pattern (Settings > Collection > File name pattern).

Values come from your sheet, so they're only as current as you keep them.

## The Collection page

- **List** or **Grid** (cover art and titles); your browser remembers which.
- **The A–Z bar** at the right side of a long list: tap a letter to jump to the first game starting with it (# for a number), on whichever page it's on; a list sorted another way is put in A to Z order first. Letters with no games are dimmed. Settings › Interface › Tables › **A–Z bar from** sets how long a list must be to have it (40 games; 0 for none).

**Box art or a table, everywhere.** The game lists have a **Box art · Table** switch at their top, remembered on each device: the Stash (its List and Grid), Series and a series' games, a console's games, the Acorns wishlist, a set's games, the PC library (Steam's own box art for a Steam game), the PC wishlist, Copies, Upgrades, the Backlog and For sale; Past releases and Coming soon show box art year by year and month by month. Settings › Interface › Tables › **Game lists open as** says how a list opens the first time.
- Filters by console, region, condition and title; by what you played ([What you played](playing.md)); and by where a copy is, its tags, and whether it's lent or for sale ([Your copies](your-copies.md)). Click a column's heading to sort by it, and again for the other way (titles A to Z first; value, price paid and Added most or newest first). The sort menu does the same in the grid and on a phone, with a button beside it to reverse it.
- A copy from another region has a badge (JP, PAL, Asia).
- **Download > What's shown here (CSV)** gives the copies on the page as a spreadsheet that Excel or Google Sheets open: every copy with its console, region, condition, value, price paid, dates, the catalog game it counts as, what you played of it and its storage location. It follows the page's filters.
- **Download > Everything (Excel workbook)** gives one .xlsx file with a tab for each part: a summary by console, the whole collection, the wishlist, each console's missing games, what you played, your loans, the games for sale, your notes, the PC library and the Top 100 lists of the consoles you collect.
- **Spending** shows what your copies cost by the month you bought them, with a monthly budget if you set one (Settings > Collection).

Click a title or a cover to open the **game drawer**: your copies with their value over time, where else you have the game, its catalog status, its acorns on the wishlist, your note on it, and links to its prices.

## Statistics and the report

Statistics' **Paid** says what you recorded paying, and beside it your [estimates](your-copies.md#estimated-prices) for the copies whose price you don't know (never part of what you paid).

- **Nutshell > Statistics** counts your collection every way: copies and value by console, condition and region; games by the decade they came out and by genre (from IGDB); copies added each year, what you spent each year, what you played, and your most valuable copies. **Value by platform over time** shows each console's value at every collection update (the 12 most valuable, with the change since the first update); it starts with the updates Squirrelcade kept when you installed 0.13.0, and every update after adds a point.
- **Your goal**: Settings > Collection > Your goal takes how many copies (or games) you mean to have. Today and Statistics then show how far you are, the change over the last 12 months (the copies that came, by the day you bought them, less the ones that left) and when you'd get there at that pace. Once you're there, they say how many are over it, with a link to [what to sell](selling.md), and each copy you add (I bought it, Add a copy) says so as it's added: one in, one out.
- **Nutshell > Report** lists every copy by console with its condition, region and value (and what you paid and where it's kept), with totals, laid out to print or save as a PDF: **Print or save as PDF**. Handy for insurance, or a record of the collection.

## Copies

**Stash > Copies** shows each game with every copy you have of it: on each console and, with the PC library on, on PC.

- **Sealed, playable another way:** games you keep sealed that you can still play without opening them: owned on PC (Steam, GOG...), another copy that's open, or in RomM. **Which way to play** narrows it to one of those.
- **Sealed, no other way:** playing them means opening one, or getting another copy.
- **Same item more than once:** games you have twice or more on one console (two complete copies, or a sealed one and an open one). They're why the Stash page has more copies than games: **Games** counts each game once (these included), **Copies** counts every copy, as PriceCharting's Count does, and the small line under Copies says how many are **duplicates**: the second, third and further copies of the same item. Games plus duplicates make the copies.
- **More than once:** several copies, copies on several consoles, or a copy and the PC game. A copy is a physical item: a sealed one and an open one are two copies; a PC game is shown beside them but isn't counted as a copy ("1 copy, sealed, and on PC").
- **Everything.**

Games are put together by title (without edition marks such as "Collector's Edition"). When that's wrong, click the copy:

- **It's the same game as...** puts it with another game (a game with two names, such as a Japanese title).
- **It's a different game** puts it on its own (two games with one name).
- **Put it back with its title** undoes either.

## Regions

On consoles that can't play other regions' games (a setting: Settings > Platforms > Region-locked consoles), copies from another region are a console of their own: a Japanese Super Nintendo game counts on the Super Famicom, with its own catalog. On region-free consoles (the Switch, say), every region counts as one console.

## Value and prices

Each copy's value is PriceCharting's price in the export, for the condition you recorded (loose, complete, new...), in the currency set in Settings > General (Squirrelcade shows the export's amounts as they are; it doesn't convert between currencies). Squirrelcade keeps each copy's value from every export that changed it, so the game drawer shows its history, and the Platforms page shows how much each console's value moved since the previous update. Prices of games you don't own aren't known: PriceCharting's export only has your own.
