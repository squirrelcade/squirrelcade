# PC library

The PC library brings your PC games from every storefront (Steam, GOG, Epic, Xbox, EA app, Ubisoft Connect...) into Squirrelcade, read from [Playnite](https://playnite.link)'s library backups. It's off in a new install: **Settings > PC library** turns it on.

## Setting it up

1. In Playnite (on your Windows PC): **Settings > Backup**, save library backups to a folder your Squirrelcade server can reach (a NAS share, say). Weekly is enough.
2. Mount that folder into the Squirrelcade container at `/playnite` (read-only is enough), for example in the compose file:
   `- /path/to/Playnite Backup:/playnite:ro`
   Outside Docker, name the folder in Settings > PC library.
3. Turn the PC library on in Settings > Features (outside Docker, name the folder right under the switch) and save. Squirrelcade reads the newest backup within a few minutes, then checks daily (Settings > PC library).

Backups can be gigabytes of artwork, but only the library files (a few megabytes) are read, in place: nothing is uploaded or copied. A reading that would lose an unusual share of your games (20% by default) waits for your confirmation on the PC library page. On a NAS share that only a group may read, give the container that group (`group_add` in the compose file).

## How each storefront counts

Each game in each storefront is **owned**, **subscription** (Game Pass, EA Play, Ubisoft+: playable while you subscribe) or **not verified**. Storefronts that mix subscription games into their libraries (EA app, Ubisoft Connect, Xbox) start as not verified (Settings > PC library > "Storefronts whose games aren't simply owned"). Settle single games by clicking a storefront badge on the PC library page, or upload an **ownership audit** (a CSV of storefront, game, ownership).

## What it adds

- **PC library** in the menu, with its pages under it: the library (one row per game with the storefronts it's in, playtime, last played, and the console copies of the same game, in tabs: every PC game, on PC and a console, only on PC, and play it on PC, keep it sealed; **Download** gives it as a spreadsheet), the **PC wishlist**, and **PC deals** (the PC wishlist's games on sale now, with PC game prices on).
- **You have it on PC** in Store Mode, a PC mark on console pages, and an "Owned on PC" line in where a game's acorns come from (fewer acorns by default). Owning a game on PC never counts as owning the console game.
- Your PC games on the [Copies](collection.md#copies) page beside your console copies, where sealed console games you own on PC come first. A PC game isn't counted as a copy: "1 copy, sealed, and on PC".
- **PC library > PC wishlist:** PC games worth buying, found through IGDB (needs IGDB keys), ranked with Steam's review scores; everything you own on PC is left out.

Health checks warn when the backup folder empties or its newest backup is old (Settings > PC library).

## Steam achievements

With **Settings > Sources > Steam achievements** on, each Steam game in the PC library shows your achievements beside it: **34/50**, or **All** with a trophy once you have every one. Its tooltip says when you last played it. The filter beside Installed shows the games **Completed on Steam**, or **With Steam achievements**.

1. Sign in at steamcommunity.com/dev/apikey with your Steam account, give any domain name (your Squirrelcade's address works), and copy the **key**. It's free.
2. Your Steam profile's game details must be public, or Steam won't tell anyone your games, Squirrelcade included: in Steam, your profile, **Edit Profile**, **Privacy Settings**, **Game details: Public**.
3. In **Settings > Features**, turn on **Steam achievements**, then paste the key, and give your profile: its address (steamcommunity.com/id/yourname or /profiles/7656...), its custom name, or its 17-digit ID. **Save and test** says whose profile it is and how many games it has.

The first read asks Steam about every game you've played, which takes a few minutes. After that it runs once a day and asks only about the games you've played since. **Read now** reads them again. If Steam doesn't answer about a game, it's asked again at the next read. Squirrelcade only reads: it never changes anything on Steam. Viewers see the achievements when **Settings > Security** shares what you played with them.

## PC game prices

With **Settings > Sources > IsThereAnyDeal (PC game prices)** on, the PC wishlist shows each game's best price now (a link to the store that has it), how much off its regular price that is, and its lowest price ever, from [IsThereAnyDeal](https://isthereanydeal.com), which follows the prices of Steam, GOG, Humble, Fanatical and dozens of other stores.

1. Sign in at isthereanydeal.com (free), open your account's API page (isthereanydeal.com/app), register an app, and copy its **API key**.
2. In **Settings > Features**, turn on **PC game prices (IsThereAnyDeal)**: its key and store country (US by default) show right under the switch. Paste the key, and **Save and test** saves it and checks that IsThereAnyDeal takes it. (Once it's on, they're in Settings > Sources > IsThereAnyDeal too.)
3. Prices are read within half an hour, then every 24 hours (Settings > PC library > Prices). With a free GG.deals key too (its card on Settings > Sources), its prices for the Steam games come in beside IsThereAnyDeal's, retail and key shops, and "Which prices come first" picks the one shown; **Check prices** on the PC wishlist reads them now.

With notifications set up, you get a message when a game on the PC wishlist hits its **lowest price ever** (or, if you choose, **at least a discount** you set, 50% by default), each price once. Several at once come in one message, which names the first 10 (the PC wishlist's order) and counts the rest. **Never** only shows the prices. Squirrelcade only reads prices: it doesn't buy anything or sign in to any store.
