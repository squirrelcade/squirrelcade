# Services and tools

Every outside service, program and tool Squirrelcade works with or recommends: what it does for you, what you need, what it costs, and where it's set up. The links go to each one's own site or its official project. Each is optional unless it says otherwise, and Squirrelcade only reads from them, except for the messages you have it send and the files you take to other services yourself. What leaves your server is listed in [Optional parts](features.md#what-leaves-your-server).

## Your collection

- [PriceCharting](https://www.pricecharting.com): your collection's values. Its export updates Squirrelcade's copies, and Send to PriceCharting gives the copies added here as lines for its importer. **You need:** an account. **Cost:** free (one import and one export a week), or a paid plan. **Where:** Stash updates.
- **Your mailbox (IMAP)**: reads PriceCharting's export emails, so an export updates Squirrelcade by itself, and its wishlist deal emails. **You need:** an app password (Gmail: [app passwords](https://myaccount.google.com/apppasswords)). **Cost:** free. **Where:** Settings > Email > Stash updates from your email.
- [CLZ Games](https://clz.com/games), [GAMEYE](https://www.gameye.app) and [VGCollect](https://vgcollect.com): their exports come in like PriceCharting's (CLZ's with its barcodes). **You need:** their export file. **Cost:** free to export. **Where:** Stash updates.

## Game information

- [IGDB](https://www.igdb.com): box art, genres, series, release dates and developers, and proof of a physical release. **You need:** a [Twitch developer application](https://dev.twitch.tv/console/apps) (see [Optional parts](features.md#igdb-keys)). **Cost:** free. **Where:** Settings > Features.
- [Wikipedia](https://en.wikipedia.org): each console's list of games (its catalog), and lists for sets. **You need:** nothing. **Cost:** free. **Where:** Settings > Sources > Catalog sources.
- [Nintendo Life](https://www.nintendolife.com): which Switch 2 games are Game-Key Cards, and newer releases. **You need:** nothing (it's off to start with). **Cost:** free. **Where:** Settings > Sources > Catalog sources.
- [Steam](https://store.steampowered.com): review scores for the PC wishlist's games. **You need:** nothing. **Cost:** free. **Where:** the PC library.
- [IsThereAnyDeal](https://isthereanydeal.com): the best price now and the lowest ever of the PC wishlist's games, and a message when one drops. **You need:** a free [API key](https://isthereanydeal.com/apps/my/). **Cost:** free. **Where:** Settings > Sources > IsThereAnyDeal (PC game prices).

## Barcodes

- [UPCitemdb](https://www.upcitemdb.com): names a barcode Squirrelcade has never seen, in Store Mode. **You need:** nothing (about 100 lookups a day). **Cost:** free. **Where:** Settings > Sources > Barcodes.
- [UPC Database](https://upcdatabase.org): the same, alone or after UPCitemdb. **You need:** a free account's key (100 lookups a day). **Cost:** free, or a paid plan for more. **Where:** Settings > Sources > Barcodes.

## What you play

- [RetroAchievements](https://retroachievements.org): what you've beaten and mastered in classic games (emulators, RomM), in each game's drawer. **You need:** your username and web API key. **Cost:** free. **Where:** Settings > Features.
- [OpenXBL](https://xbl.io): your Xbox achievements and gamerscore, in each game's drawer. **You need:** a key from OpenXBL, after signing in with your Microsoft account. **Cost:** free (150 requests an hour; Squirrelcade makes one a day). **Where:** Settings > Sources > Xbox achievements.
- [PlayStation](https://www.playstation.com), through [psn-api](https://github.com/achievements-app/psn-api): your trophies and platinums, in each game's drawer. It's unofficial: it uses the PlayStation App's API. **You need:** a sign-in token from your browser, which lasts about two months (see [What you played](playing.md#xbox-achievements-and-playstation-trophies)). **Cost:** free. **Where:** Settings > Sources > PlayStation trophies.
- [Steam](https://store.steampowered.com), through the [Steam Web API](https://steamcommunity.com/dev/apikey): your achievements in the PC library's Steam games, beside each game, with a filter for the games you completed. **You need:** a free Web API key and your Steam profile, with its game details public. **Cost:** free (100,000 requests a day; after the first read, Squirrelcade asks only about the games you played since). **Where:** Settings > Sources > Steam achievements.
- [Playnite](https://playnite.link): your PC games from every storefront, from Playnite's backups. **You need:** Playnite on a Windows PC, with its backup folder shared with Squirrelcade. **Cost:** free, open source. **Where:** Settings > PC library.
- [RomM](https://romm.app): links from your games to your own ROM library, to open or play them. **You need:** a RomM server of your own and its API token. **Cost:** free, open source. **Where:** Settings > Sources > RomM (your ROM library).

## Selling

- [eBay](https://www.ebay.com): Ready to sell writes the listing, and the game's sold listings show what copies really go for. **You need:** a seller account. **Cost:** a fee on each sale (about 13.6% and 40¢ an order in the US). **Where:** Settings > Collection > Selling.
- [Mercari](https://www.mercari.com): the same, with Mercari's conditions. **You need:** an account. **Cost:** a fee on each sale (10% in the US). **Where:** Settings > Collection > Selling.

## Ripping and dumping

A rip reads all of a disc (or cartridge) into a file and checks it against a list of verified dumps: the best test there is, and a listing says so. See [Selling your games](selling.md#tested-and-ripped).

- [OmniDrive](https://github.com/RibShark/OmniDrive): firmware for Blu-ray drives that reads the game discs a PC drive otherwise can't (Xbox, Xbox 360, Xbox One, Series X, GameCube, Wii and Wii U). **You need:** an ASUS BW-16D1HT, or one of the LG drives it lists, flashed with it; the steps are on [Redump's wiki](https://wiki.redump.info). **Cost:** free.
- [redumper](https://github.com/superg/redumper): the dumper Redump uses, for CDs (PlayStation, Saturn, Sega CD, 3DO), DVDs (PS2, and the discs above with OmniDrive) and Blu-rays (PS3, PS4, PS5). **You need:** a PC and a supported drive. **Cost:** free, open source.
- [MPF](https://github.com/SabreTools/MPF) (Media Preservation Frontend): a window for redumper. **Cost:** free, open source.
- [Redump](https://redump.info): the list of verified dumps a rip is checked against. **Cost:** free.
- [Open Source Cartridge Reader](https://github.com/oscartreader): reads the cartridges of many consoles. **You need:** the reader (build one, or buy it assembled). **Cost:** open hardware. **Where:** add its consoles to Settings > Collection > Your copies > Consoles whose games you rip.

## Messages

All in Settings > Notifications, each with its own switch; [Notifications](notifications.md) has the steps for each.

- **Email**: your provider's mail server and an app password (the common providers are filled in for you). **Cost:** free.
- [Pushover](https://pushover.net): a user key and an application's token. **Cost:** a one-time purchase after a trial.
- [Pushbullet](https://www.pushbullet.com): an access token. **Cost:** free for up to 500 pushes a month.
- [ntfy](https://ntfy.sh): a topic, on ntfy.sh or a server of your own. **Cost:** free.
- [Gotify](https://gotify.net): a Gotify server of your own and an application's token. **Cost:** free, open source.
- [Discord](https://discord.com): a channel's webhook. **Cost:** free.
- [Telegram](https://telegram.org): a bot's token and your chat. **Cost:** free.
- [Slack](https://slack.com): an incoming webhook. **Cost:** free.
- **A webhook**, for [n8n](https://n8n.io), [Home Assistant](https://www.home-assistant.io), [Node-RED](https://nodered.org) or anything that takes a web request: its address. **Cost:** free.
- [Apprise API](https://github.com/caronc/apprise-api): an Apprise server of your own, which reaches 100 more services (Signal, Matrix, Teams, SMS). **Cost:** free, open source.

## Running Squirrelcade and reaching it

- [Docker](https://www.docker.com): Squirrelcade runs as a container, on a NAS (Synology's Container Manager, Unraid, TrueNAS), with Portainer, or on any server. **Cost:** free.
- [Tailscale](https://tailscale.com): reaching Squirrelcade from your phone over a private network of your own devices, with the HTTPS the barcode camera needs. **Cost:** free for personal use.
- [Cloudflare Tunnel and Access](https://developers.cloudflare.com/cloudflare-one/): a web address for Squirrelcade behind a sign-in, for you and family, with nothing opened on your router. **You need:** a free account and a domain of your own (a few dollars a year).
- **A reverse proxy** ([Nginx Proxy Manager](https://nginxproxymanager.com), [Caddy](https://caddyserver.com), [Traefik](https://traefik.io)): Squirrelcade's address with a certificate, if you already run one. **Cost:** free.

Don't open Squirrelcade to the whole internet without a gate in front of it: a private network, Cloudflare Access, or your proxy's own sign-in.

## Programs that read Squirrelcade

- [Homepage](https://gethomepage.dev): shows your collection's totals on your dashboard (the stats address in the API). **Cost:** free, open source.
- [Uptime Kuma](https://github.com/louislam/uptime-kuma): tells you when Squirrelcade is down (its health address). **Cost:** free, open source.
- [n8n](https://n8n.io): automations, with messages from Squirrelcade's webhook and whether you own a game from its API. **Cost:** free to run yourself.

Other programs can use Squirrelcade's API with its key: Settings > Security has the key, and the API's own guide is in Squirrelcade's repository (docs/API.md).
