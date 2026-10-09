# Getting started

Squirrelcade keeps track of a video game collection. Bring yours in from an export (PriceCharting's, CLZ Games', GAMEYE's, VGCollect's, or a spreadsheet of your own), or type your games in one at a time with **Add a game**. Every copy is a record of its own in Squirrelcade: new ones come with the next export, or you add them here (**Add a game**, **I bought it** in a store, or **Add a copy** on a game you have). It turns them into:

- your collection by console, with each copy's value, condition and region, what you spend by month, and a goal if you have one;
- each console's catalog of games, and how complete your collection of it is;
- a wishlist that ranks the games you don't have by your own rules, explaining every point;
- Store Mode for your phone: scan or type a game in a store and see at once whether you have it;
- your copies looked after (where each is, tests, standard photos) and, when you sell one, its listing written for eBay or Mercari;
- what you played, with your achievements from RetroAchievements, Xbox, PlayStation and Steam if you like;
- each console's Top 100 games and history, and every copy you have of each game.

**Squirrelcade works on its own:** no AI, no outside account and no subscription. Only your games are needed. Everything else (values from PriceCharting, covers from IGDB, your PC games from Playnite, links to RomM, notifications, Claude) is optional and can be switched on or off: see [Optional parts](features.md). Rather have an AI assistant take you through the setup? See [AI-assisted setup](ai-setup.md).

## What you need

- A computer or server that runs Docker (a NAS, a mini PC, any Linux machine). [Install and set up Squirrelcade](../guide/README.md) goes through it step by step.
- Your games, from an export: [PriceCharting](https://www.pricecharting.com)'s (**My Collection > Download (CSV)**; keep the file's name, `collection_YYYYMMDD.csv`, since its date is the date of the prices), CLZ Games', GAMEYE's, VGCollect's, or a spreadsheet of your own.
- Or no export at all: **Add a game** takes your games one at a time.

Values come from a PriceCharting export, or from a Value column in a spreadsheet of your own. Games you type in have none until then; everything else works the same.

## The first visit

1. **Create your account.** The first page asks for a username and password. This account is the collection's owner. From outside your home network, it also asks for a **setup code**, which Squirrelcade writes in its log when it starts (on the line that begins "No account yet"), so nobody else can claim a new install.
2. **The welcome guide** takes you through five steps:
   - **Your collection:** drop in the export (the `collection.zip` PriceCharting sends works as it is), or **Add games one at a time** (then **Back to the welcome guide** at the top of Add a game).
   - **Consoles:** a console gets a catalog once you own a few different games for it (6 by default; Settings > Platforms).
   - **Catalogs:** each of those consoles gets a catalog, built from Wikipedia's list of its games. If you keep your own list of a console's games, you can use it instead.
   - **Covers (optional):** free IGDB keys give covers, genres and series. See [Optional parts](features.md).
   - **Wishlist (optional):** put the consoles and genres you like in your own order.

After that, the menu on the left has everything (on a phone, the bar at the bottom has Today, Collection, Store Mode and Acorns, and **More** opens the menu):

| Page | What it's for |
| --- | --- |
| **Today** | The home page: what matters today on one screen (below). The squirrel at the top left brings you back to it from anywhere. |
| **Stash** | Your collection: your copies, as a list or a grid, with filters, and a spreadsheet download. Under it: **Copies** (every copy of each game across consoles, and your PC games beside them), **Upgrades**, **Improve** (what each copy is missing), **Backlog**, **Loans**, and **Stash updates** (where new exports go, with what each one added and removed). |
| **Acorns** | Games coming in and going out: the **Acorns wishlist** (the games worth getting next), **Coming soon**, **Past releases** (the ones that came out around this time in past years), **Deals**, **For sale**, **Sales** (what you sold, and what to sell next), and **Acorns ranking** (the rules that give acorns). |
| **Almanac** | **Platforms** (each console's completion, its catalog, its Top 100 and its history; **Timeline** shows consoles and landmark games by year), **Sets** (your own sets beyond consoles: a publisher's releases, a series), **Statistics** (your collection counted every way) and **Report** (every copy, to print). |
| **Friends** | Your collection next to your friends': each friend's page has **Compare** and **Trades**. See [Friends](friends.md). |
| **PC library** | With the PC library on: your PC games, and under it the **PC wishlist** and **PC deals** (its games on sale now). |
| **Store Mode** | For your phone in a store: the button at the top (and in the bar at the bottom on a phone). |
| **Settings**, **System** | Everything you can change, and under System: **Review** (titles that look alike, for you to answer: the same game, or not; its count shows on System), the server's status, tasks, backups and logs. |

**Today**, card by card:

- **The game of the day:** its acorns and where they come from, and its reviews.
- **This week in game history:** games that came out this week in earlier years.
- **Releases** on your consoles in the next seven days (the arrows look at the weeks ahead).
- **Deals** against the market value.
- **Your last update** and the collection's pulse: copies, your goal, copies added each year, by console.
- **The biggest price changes,** and the lists closest to done.

While a new install still has essential setup steps left, they come first. **Settings > Interface > Start page** chooses the page Squirrelcade opens on.

Click any game's title (or its cover) to open everything about it in one panel, the game drawer. The search box at the top (press **/**) finds any game on your consoles, and with the PC library on, your PC games too (a remaster that only came out as a download, say), which open in the PC library. Numbers can be typed either way: "Mafia 2" finds "Mafia II".

## Keeping it up to date

- **A game you buy:** add it in Squirrelcade, with **Add a game**, **I bought it** (in Store Mode or a game's drawer) or **Add a copy** (on a game you have).
- **A game you sell:** mark it **Sold**. **Ready to sell** writes its listing first.
- **With PriceCharting too:** **Stash updates > Send to PriceCharting** gives the copies added here as lines for PriceCharting's importer. Its next export then updates Squirrelcade: add it on **Stash updates**, save it into the watched folder, or let Squirrelcade pick it up from your email. Squirrelcade shows what each update added and removed.

See [Your collection](collection.md) and [Selling your games](selling.md).

## Getting help

Each page's **?** button opens its help. If something goes wrong, **System > Status > Support file** downloads what someone helping you needs (never passwords or keys). See [When something goes wrong](troubleshooting.md).
