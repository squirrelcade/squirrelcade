# Your collection

Squirrelcade keeps your collection: every copy you own is a record of its own, with what only you know about it (where it is, tags, loans, photos). Type your games in (**Add a game**, below), or keep them up to date from an export: PriceCharting's brings each copy's value and its history, and a spreadsheet of your own or another collection app's export works too. Both together work as well.

The Stash's mark is a little treasure chest. Wherever Squirrelcade says you have a game ("Have it", "You own it", "Owned"), the chest is beside it, as the acorn is beside what you want.

## Updating it

1. On PriceCharting, **My Collection > Download (CSV)**. Keep the file's name (`collection_YYYYMMDD.csv`): its date is the date of the prices.
2. In Squirrelcade, open **Stash > Stash updates** (or click **Update** on the Stash page) and drop the file on the box, or click the box to choose it. The `collection.zip` PriceCharting sends works as it is.

Other ways in: let Squirrelcade pick it up from your email (below), or save the file into the watched folder (the `imports` folder of a Docker install). Squirrelcade checks that folder every 15 minutes (Settings > Tasks), and **Settings > Collection** has its switch and its file name pattern.

Squirrelcade matches the export's copies to the ones it keeps (the same game in the same condition), adds the new ones, and shows what was added and removed. An export that would remove an unusual share of your games (10% by default) is **held** until you confirm it on Stash updates, in case the export was cut short.

A copy the new export no longer has isn't removed: it waits on **Review > Copies**, still counted, until you say what happened. **I still have it** keeps it as a copy of your own that no export removes (add it back on PriceCharting if you want its value there); **Sold** or **Gone** takes it out of your collection. The Review menu counts them, and the Stash page and the game's drawer mark them. To have such copies leave with the update instead (as before 0.19.0): Settings > Collection > Safety > **A copy the next update no longer has**.

## Adding a game by hand

**Add a game** (in the menu under **Acorns**, and a button on the Stash page) adds a game you have, typed in:

1. **Console:** pick it. Your consoles come first; every console Squirrelcade knows is there.
2. **Title:** start typing. Squirrelcade suggests titles from the console's catalog (with IGDB's too, when its keys are set up) and from your own games ("You have 1"). Pick a suggestion to match the game the catalog knows, or keep your own title: it's added as you typed it.
3. **The copy:** its condition, what you paid, the day you bought it and a note, each optional. **Add it.**

The form stays on the console for the next game, and **Added just now** lists what you added, each opening its page. Its value stays empty until a PriceCharting export has the game (see **Sending to PriceCharting** below). A console gets its catalog a few minutes after it has 6 different games (Settings > Platforms), and then suggests every one of its games. Until then, it suggests only the games you've added to it, and the page says so. Typing a collection in? Set that number to 1, and each console gets its catalog after its first game.

## Adding a copy in Squirrelcade

A game's drawer has **Add a copy**: its condition, and what you paid, when and a note if you like. **I bought it** (in the drawer and in Store Mode) adds one in one tap, bought today, in the condition Settings > Collection > Adding copies gives a game just bought. The copy counts at once; its value comes with the export that has it (or from another copy of the same game in that condition, if you have one from PriceCharting). Under **Your copies**, a copy added here says **Added in Squirrelcade: not on PriceCharting yet**, with **send it** and, while nothing is kept on it, **take back**.

**Change it** (under each copy, with where it is, lending and photos): its condition, what you paid, the day you bought it and notes, for any copy, one from PriceCharting's export too. What you change here stays yours: no export overwrites it, and the export still finds the copy. **Sold** or **Remove** takes it out of your collection (it stays in the history).

## Sending to PriceCharting

PriceCharting keeps the prices, so a copy added in Squirrelcade gets its value once it's on PriceCharting too:

1. **Stash updates > Send to PriceCharting** lists the copies added here as lines for PriceCharting's importer ("Okami Playstation 2 CIB"). Click **Copy the list**.
2. Click **Open PriceCharting's importer**, paste the list there and add the games.
3. Back in Squirrelcade, click **I've added them there**.
4. Export from PriceCharting as usual, and bring the export in. It brings each copy's value to the same copy here (not a second one); what you paid, the day and your notes stay Squirrelcade's.

PriceCharting's importer reads CIB and Sealed. A copy in another condition comes in as loose, so set its condition there after pasting (the card says which). A free PriceCharting account takes one import and one export a week.

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
- Filters by console, region, condition and title; by what you played ([What you played](playing.md)); and by where a copy is, its tags, and whether it's lent or for sale ([Your copies](your-copies.md)). Click a column's heading to sort by it, and again for the other way (titles A to Z first; value, price paid and Added most or newest first). The sort menu does the same in the grid and on a phone, with a button beside it to reverse it.
- A copy from another region has a badge (JP, PAL, Asia).
- **Download > What's shown here (CSV)** gives the copies on the page as a spreadsheet that Excel or Google Sheets open: every copy with its console, region, condition, value, price paid, dates, the catalog game it counts as, what you played of it and where it is. It follows the page's filters.
- **Download > Everything (Excel workbook)** gives one .xlsx file with a tab for each part: a summary by console, the whole collection, the wishlist, each console's missing games, what you played, your loans, the games for sale, your notes, the PC library and the Top 100 lists of the consoles you collect.
- **Spending** shows what your copies cost by the month you bought them, with a monthly budget if you set one (Settings > Collection).

Click a title or a cover to open the **game drawer**: your copies with their value over time, where else you have the game, its catalog status, its acorns on the wishlist, your note on it, and links to its prices.

## Statistics and the report

Statistics' **Paid** says what you recorded paying, and beside it your [estimates](your-copies.md#estimated-prices) for the copies whose price you don't know (never part of what you paid).

- **Almanac > Statistics** counts your collection every way: copies and value by console, condition and region; games by the decade they came out and by genre (from IGDB); copies added each year, what you spent each year, what you played, and your most valuable copies. **Value by platform over time** shows each console's value at every collection update (the 12 most valuable, with the change since the first update); it starts with the updates Squirrelcade kept when you installed 0.13.0, and every update after adds a point.
- **Your goal**: Settings > Collection > Your goal takes how many copies (or games) you mean to have. Today and Statistics then show how far you are, the change over the last 12 months (the copies that came, by the day you bought them, less the ones that left) and when you'd get there at that pace. Once you're there, they say how many are over it, with a link to [what to sell](selling.md), and each copy you add (I bought it, Add a copy) says so as it's added: one in, one out.
- **Almanac > Report** lists every copy by console with its condition, region and value (and what you paid and where it's kept), with totals, laid out to print or save as a PDF: **Print or save as PDF**. Handy for insurance, or a record of the collection.

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
