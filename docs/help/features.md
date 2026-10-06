# Optional parts

Only your games are required, typed in or from an export. Every part of Squirrelcade that needs another program or an outside service is optional, and **Settings > Features** switches the main ones on or off. Each part is set up in one place, with its switch there too: a card on Settings > Sources (the PC library on its own page, the email account on Settings > Email), with the steps under **Set it up, step by step**, what it needs (a key, an address, a folder) and a test. A switch on Features links to that card. A part that's off leaves the menus, its settings elsewhere are hidden (they keep their values, for when you turn it back on; the pages they're on say so, with a link to its card), and its background tasks stop.

| Part | What it does | What it needs | New installs |
| --- | --- | --- | --- |
| **Covers and game details from IGDB** | Box art, genres, series, developers and release dates, for the pages, the wishlist's acorns and the catalogs. Off, Squirrelcade never contacts IGDB. | A free Twitch developer application (below). | On (it does nothing until it has its keys) |
| **Top 100 lists and console history** | Each console's best games in ranked order, its history, and a timeline. See [Top 100 and history](top100-history.md). | Nothing: it comes with Squirrelcade. | On |
| **PC library** | Your PC games from every storefront, read from Playnite's backups; a PC wishlist; your PC games next to your console copies. See [PC library](pc-library.md). | Playnite on a Windows PC, and its backup folder mounted into Squirrelcade. | Off |
| **RomM links** | Links from your games to your own RomM, to open or play them. See [RomM](romm.md). | A RomM server and an API token. | Off |
| **PC game prices (IsThereAnyDeal)** | The best price now and the lowest ever of each game on the PC wishlist, and a message when one drops. See [PC library](pc-library.md#pc-game-prices). | The PC library, and a free IsThereAnyDeal API key. | Off |
| **Stash updates from your email** | Your collection updated from PriceCharting's export email as soon as it arrives. See [Your collection](collection.md#from-your-email). | Your email account on Settings > Email (address and app password), the same one notifications use. | Off |
| **RetroAchievements** | What you've beaten, completed and mastered on RetroAchievements, in each game's drawer, and if you like in What you played. See [What you played](playing.md#retroachievements). | Your RetroAchievements username and its free web API key. | Off |
| **Xbox achievements** | How far you got in each game on Xbox 360, One and Series X and S, in its drawer, and if you like in What you played. See [What you played](playing.md#xbox-achievements-and-playstation-trophies). | A free OpenXBL key (sign in at xbl.io with your Microsoft account). | Off |
| **Steam achievements** | Your achievements in the PC library's Steam games, beside each game, with a filter for the games you completed. See [PC library](pc-library.md#steam-achievements). | The PC library, a free Steam Web API key, and your Steam profile with its game details public. | Off |
| **PlayStation trophies** | Your trophies and platinums on PS3, PS4, PS5 and Vita, the same way. Unofficial: it uses the PlayStation App's API. | A sign-in token copied from your browser (it lasts about two months). | Off |

Every outside service and tool, with its link, what you need and what it costs, is in [Services and tools](services.md).

Other outside services have their own switch where they're set up; Settings > Features lists them too:

- **Messages:** email, Pushover, Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, a webhook or Apprise, each with its own switch in Settings > Notifications. See [Notifications](notifications.md).
- **Naming unknown barcodes:** Store Mode asks UPCitemdb (free, no account), UPC Database (upcdatabase.org: a free account's key) or both about a barcode it has never seen. Settings > Sources > Barcodes.
- **Catalog sources:** Wikipedia's game lists, and Nintendo Life's lists of Switch 2 Game-Key Cards (off unless you turn it on). Settings > Sources > Catalog sources. See [Catalogs](catalogs.md).
- **Checking a game without signing in,** and **share links** for your wishlist or the games for sale: see [Sharing your collection](sharing.md).

## IGDB keys

IGDB is free with a Twitch developer application:

1. Sign in at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) with a Twitch account (free) that has two-factor sign-in turned on, and register an application: any name, OAuth redirect `http://localhost`, category **Application Integration**, client type **Confidential** (a Public one can't have a secret).
2. Under **Manage**, copy its **Client ID**, then **New Secret** and copy the secret.
3. Enter both under the IGDB switch in **Settings > Features** (or in **Settings > Sources > IGDB**) and save. **Test** checks them.

Squirrelcade then downloads IGDB's list of games for each console with a catalog, and again once a week. The same pair of keys works for RomM, if you use it.

## What leaves your server

Squirrelcade has no tracking of any kind. It contacts Wikipedia (catalogs and sets), and, when you turn them on and set them up: IGDB, Steam's public review summaries (PC wishlist), IsThereAnyDeal (PC game prices: the wishlist's games, never your library), your mailbox and PriceCharting's storage (collection updates from your email), Nintendo Life, UPCitemdb or UPC Database (only a barcode's digits), RetroAchievements (your progress, read with your key), OpenXBL (your Xbox achievements, read with your key), Steam's Web API (your Steam achievements, read with your key), PlayStation's servers (your trophies, read with your sign-in token), your own RomM, and the ways to send messages you turn on (your email server, Pushover, Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, your webhook or Apprise). Photos of your copies stay on your server. With **Settings > Claude and AI apps** on and an app connected, the answers to that app's questions go to its servers (games, copies and their condition; what you paid and your notes only if you let them in). With the sign-in from the internet on, Squirrelcade also reads an app's public description from its address (claude.ai) when it signs in ([Claude and AI apps](ai-apps.md)).
